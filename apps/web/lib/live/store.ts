import 'server-only';
import { randomBytes } from 'node:crypto';
import { formatInZone, zonedToUtc } from '@unoa/domain/time';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, Problem, numeric, ensure, uuid, type Input, flag, optionalText } from '@/lib/shared/validation';
import { canTeach, offeringFor, type OfferingRow } from '@/lib/lms/offerings';
import { notify } from '@/lib/notifications/store';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { joinUrl, liveProvider } from './provider';

const joinLead = 15 * 60_000;

function schedule(input: Input, item: OfferingRow) {
  const startsAt = zonedToUtc(String(input.startsAt ?? ''), item.time_zone);
  ensure(startsAt, 400, 'Début invalide');
  const minutes = numeric(input.durationMinutes);
  ensure(Number.isInteger(minutes) && minutes >= 5 && minutes <= 720, 400, 'Durée invalide');
  ensure(startsAt.getTime() > Date.now(), 422, 'Une séance se planifie dans le futur');
  return { startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60_000) };
}

interface SessionRow {
  id: string; offering_id: string; title: string; starts_at: Date; ends_at: Date; state: string; room: string;
  recording_planned: boolean;
}

async function session(store: Queryable, actor: string, sessionId: string) {
  const { rows } = await store.query<SessionRow>(
    'SELECT id, offering_id, title, starts_at, ends_at, state, room, recording_planned FROM unoa.live_session WHERE id = $1', [sessionId],
  );
  ensure(rows[0], 404, 'Séance introuvable');
  const item = await offeringFor(store, actor, rows[0].offering_id);
  return { session: rows[0], offering: item };
}

const link = (offeringId: string) => `/apprendre/${offeringId}#seances`;

export async function scheduleSession(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const offeringId = uuid(id);
  const title = boundedText(input.title, 200, 'Titre');
  const agenda = optionalText(input.agenda) === null ? null : boundedText(input.agenda, 4000, 'Ordre du jour');
  return transaction(settings, 'unoa.live.offering.' + offeringId, async store => {
    const item = await offeringFor(store, actor, offeringId);
    ensure(canTeach(item), 403, 'Planification réservée à l’équipe enseignante');
    const { startsAt, endsAt } = schedule(input, item);
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.live_session(offering_id, title, agenda, starts_at, ends_at, room, recording_planned, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
    `, [offeringId, title, agenda, startsAt, endsAt, randomBytes(20).toString('hex'), flag(input.recordingPlanned), actor]);
    await store.query(`INSERT INTO unoa.live_event(session_id, kind, actor_id, starts_at, ends_at) VALUES ($1, 'scheduled', $2, $3, $4)`,
      [rows[0].id, actor, startsAt, endsAt]);
    await notify(store, offeringId, actor, 'live.scheduled', 'Séance planifiée : ' + title,
      formatInZone(startsAt, item.time_zone) + (flag(input.recordingPlanned) ? ' · enregistrement annoncé' : ''), link(offeringId));
    await audit(store, actor, item.owner_scope_id, 'live.session_scheduled', correlation, rows[0].id);
    return { id: rows[0].id, offeringId };
  });
}

export async function changeSession(settings: IamSettings, actor: string, id: string, action: string, input: Input, correlation: string) {
  const sessionId = uuid(id);
  return transaction(settings, 'unoa.live.session.' + sessionId, async store => {
    const found = await session(store, actor, sessionId);
    const { offering: item } = found;
    const reason = optionalText(input.reason) === null ? null : boundedText(input.reason, 500, 'Motif');
    if (action === 'consent') {
      ensure(item.role, 403, 'Consentement réservé aux participants');
      const decision = input.decision === 'granted' || input.decision === 'refused' ? input.decision : null;
      ensure(decision, 400, 'Décision invalide');
      ensure(found.session.recording_planned, 409, 'Aucun enregistrement n’est annoncé');
      await store.query(`
        INSERT INTO unoa.live_consent(session_id, account_id, decision) VALUES ($1, $2, $3)
        ON CONFLICT (session_id, account_id) DO UPDATE SET decision = excluded.decision, decided_at = now()
      `, [sessionId, actor, decision]);
      await audit(store, actor, item.owner_scope_id, 'live.consent_recorded', correlation, sessionId);
      return { id: sessionId, offeringId: item.id };
    }
    ensure(canTeach(item), 403, 'Action réservée à l’équipe enseignante');
    ensure(found.session.state === 'scheduled', 409, 'Séance annulée');
    if (action === 'reschedule') {
      ensure(reason, 400, 'Motiver le report');
      const { startsAt, endsAt } = schedule(input, item);
      await store.query('UPDATE unoa.live_session SET starts_at = $2, ends_at = $3 WHERE id = $1', [sessionId, startsAt, endsAt]);
      await store.query(`INSERT INTO unoa.live_event(session_id, kind, actor_id, starts_at, ends_at, detail) VALUES ($1, 'rescheduled', $2, $3, $4, $5)`,
        [sessionId, actor, startsAt, endsAt, reason]);
      await notify(store, item.id, actor, 'live.rescheduled', 'Séance reportée : ' + found.session.title,
        'Nouvel horaire : ' + formatInZone(startsAt, item.time_zone) + '. ' + reason, link(item.id));
    } else if (action === 'cancel') {
      ensure(reason, 400, 'Motiver l’annulation');
      await store.query("UPDATE unoa.live_session SET state = 'cancelled', cancel_reason = $2 WHERE id = $1", [sessionId, reason]);
      await store.query(`INSERT INTO unoa.live_event(session_id, kind, actor_id, detail) VALUES ($1, 'cancelled', $2, $3)`, [sessionId, actor, reason]);
      await notify(store, item.id, actor, 'live.cancelled', 'Séance annulée : ' + found.session.title, reason, link(item.id));
    } else if (action === 'recording') {
      await store.query('UPDATE unoa.live_session SET recording_planned = true WHERE id = $1', [sessionId]);
      await store.query(`INSERT INTO unoa.live_event(session_id, kind, actor_id, detail) VALUES ($1, 'recording_announced', $2, $3)`, [sessionId, actor, reason]);
      await notify(store, item.id, actor, 'live.recording', 'Enregistrement annoncé : ' + found.session.title,
        'Indiquez votre consentement avant la séance.', link(item.id));
    } else if (action === 'replay') {
      const url = String(input.url ?? '');
      ensure(/^https:\/\/[^\s]+$/.test(url) && url.length <= 2000, 400, 'Adresse HTTPS requise');
      await store.query('UPDATE unoa.live_session SET replay_url = $2, replay_published_at = now() WHERE id = $1', [sessionId, url]);
      await store.query(`INSERT INTO unoa.live_event(session_id, kind, actor_id) VALUES ($1, 'replay_published', $2)`, [sessionId, actor]);
      await notify(store, item.id, actor, 'live.replay', 'Replay disponible : ' + found.session.title, null, link(item.id));
    } else if (action === 'resources') {
      const url = String(input.url ?? '');
      ensure(/^https:\/\/[^\s]+$/.test(url) && url.length <= 2000, 400, 'Adresse HTTPS requise');
      await store.query('INSERT INTO unoa.live_resource(session_id, title, url, shared_by) VALUES ($1, $2, $3, $4)',
        [sessionId, boundedText(input.title, 200, 'Titre'), url, actor]);
    } else if (action === 'attendance') {
      const accountId = uuid(input.accountId);
      const status = ['present', 'absent', 'excused'].includes(String(input.status)) ? String(input.status) : null;
      ensure(status, 400, 'Statut de présence invalide');
      ensure(found.session.starts_at.getTime() <= Date.now(), 409, 'La présence se pointe une fois la séance commencée');
      const { rows } = await store.query('SELECT 1 FROM unoa.offering_member WHERE offering_id = $1 AND account_id = $2 AND removed_at IS NULL',
        [item.id, accountId]);
      ensure(rows[0], 404, 'Participant inconnu');
      await store.query(`
        INSERT INTO unoa.live_attendance(session_id, account_id, status, marked_by, marked_at) VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (session_id, account_id) DO UPDATE SET status = excluded.status, marked_by = excluded.marked_by, marked_at = now()
      `, [sessionId, accountId, status, actor]);
    } else {
      throw new Problem(404, 'Opération inconnue');
    }
    await audit(store, actor, item.owner_scope_id, 'live.session_' + action, correlation, sessionId);
    return { id: sessionId, offeringId: item.id };
  });
}

// The join link is produced for a member only, inside the session window, and
// expires with the session: a forwarded link is useless to anyone else later.
export async function joinSession(settings: IamSettings, actor: string, id: string, correlation: string) {
  const sessionId = uuid(id);
  return transaction(settings, 'unoa.live.join.' + sessionId + actor, async store => {
    const { session: found, offering: item } = await session(store, actor, sessionId);
    ensure(item.role, 403, 'Seuls les participants inscrits rejoignent la séance');
    ensure(found.state === 'scheduled', 410, 'Séance annulée');
    const now = Date.now();
    ensure(now >= found.starts_at.getTime() - joinLead && now <= found.ends_at.getTime(), 425, 'La salle ouvre 15 minutes avant le début');
    if (found.recording_planned) {
      const { rows } = await store.query('SELECT 1 FROM unoa.live_consent WHERE session_id = $1 AND account_id = $2', [sessionId, actor]);
      ensure(rows[0], 428, 'Indiquez votre choix sur l’enregistrement avant de rejoindre');
    }
    const provider = liveProvider();
    ensure(provider, 503, 'Service de visioconférence non configuré');
    const { rows: names } = await store.query<{ display_name: string | null }>(`
      SELECT display_name FROM unoa.offering_member WHERE offering_id = $1 AND account_id = $2 AND removed_at IS NULL
      AND display_name IS NOT NULL LIMIT 1
    `, [item.id, actor]);
    await store.query(`
      INSERT INTO unoa.live_attendance(session_id, account_id, first_joined_at, joins) VALUES ($1, $2, now(), 1)
      ON CONFLICT (session_id, account_id) DO UPDATE SET first_joined_at = coalesce(unoa.live_attendance.first_joined_at, now()),
        joins = unoa.live_attendance.joins + 1
    `, [sessionId, actor]);
    await audit(store, actor, item.owner_scope_id, 'live.session_joined', correlation, sessionId);
    return joinUrl(provider, found.room, {
      id: actor, name: names[0]?.display_name ?? 'Participant', moderator: item.role === 'teacher',
    }, new Date(found.ends_at.getTime() + 30 * 60_000));
  });
}

export async function sessionRoster(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const { session: found, offering: item } = await session(store, actor, uuid(id));
  ensure(canTeach(item), 403, 'Présences réservées à l’équipe enseignante');
  const [attendance, events, consents] = await Promise.all([
    store.query<{ account_id: string; role: string; display_name: string | null; first_joined_at: Date | null; joins: number | null; status: string | null }>(`
      SELECT member.account_id, member.role, member.display_name, attendance.first_joined_at, attendance.joins, attendance.status
      FROM unoa.offering_member AS member
      LEFT JOIN unoa.live_attendance AS attendance ON attendance.session_id = $1 AND attendance.account_id = member.account_id
      WHERE member.offering_id = $2 AND member.removed_at IS NULL ORDER BY member.role, member.display_name
    `, [found.id, item.id]),
    store.query<{ kind: string; occurred_at: Date; detail: string | null }>(
      'SELECT kind, occurred_at, detail FROM unoa.live_event WHERE session_id = $1 ORDER BY occurred_at', [found.id],
    ),
    store.query<{ decision: string; total: number }>(
      'SELECT decision, count(*)::int AS total FROM unoa.live_consent WHERE session_id = $1 GROUP BY decision', [found.id],
    ),
  ]);
  return { session: found, offering: item, attendance: attendance.rows, events: events.rows, consents: consents.rows };
}
