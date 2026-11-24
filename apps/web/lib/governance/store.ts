import 'server-only';
import { createHash } from 'node:crypto';
import { outcome, quorumReached, requiredPresent, type Majority } from '@unoa/domain/governance';
import { formatInZone } from '@unoa/domain/time';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, choice, day, ensure, flag, https, integer, optional, Problem, text, utcTime, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { dispatch } from '@/lib/notifications/store';

// Councils (module GOV). Management rights are checked on the council's scope;
// voting, conflicts and appeals belong to the members themselves.

type Right = 'read' | 'manage' | 'secretary' | 'publish';
const majorities = ['simple', 'absolute', 'two_thirds'] as const;

async function rights(store: Queryable, actor: string, scopeId: string) {
  const { rows } = await store.query<Record<Right, boolean>>(`
    SELECT unoa.has_scope_permission($1, 'gov.read', $2) AS read, unoa.has_scope_permission($1, 'gov.manage', $2) AS manage,
           unoa.has_scope_permission($1, 'gov.secretary', $2) AS secretary, unoa.has_scope_permission($1, 'gov.publish', $2) AS publish
  `, [actor, scopeId]);
  return rows[0];
}

async function require(store: Queryable, actor: string, scopeId: string, right: Right) {
  const granted = await rights(store, actor, scopeId);
  ensure(granted?.[right], 403, 'Action réservée aux responsables du conseil');
  return granted;
}

export async function govContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string; nature: string }>(`
    SELECT scope.id, scope.label, kind.nature FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE kind.nature IN ('territory', 'institution', 'academic_unit') AND unoa.has_scope_permission($1, 'gov.read', scope.id)
    ORDER BY kind.nature, scope.label LIMIT 200
  `, [actor]);
  return rows;
}

export async function govOverview(settings: IamSettings, actor: string, scope: string) {
  const scopeId = uuid(scope);
  const store = database(settings);
  const granted = await require(store, actor, scopeId, 'read');
  const [label, councils] = await Promise.all([
    store.query<{ label: string }>('SELECT label FROM unoa.scope WHERE id = $1', [scopeId]),
    store.query<{ id: string; name: string; kind: string; quorum_percent: number; majority: string; scope_label: string; members: number; meetings: number; archived_at: Date | null }>(`
      SELECT council.id, council.name, council.kind, council.quorum_percent, council.majority, scope.label AS scope_label, council.archived_at,
        (SELECT count(*)::int FROM unoa.council_member WHERE council_id = council.id AND (ends_on IS NULL OR ends_on > current_date)) AS members,
        (SELECT count(*)::int FROM unoa.meeting WHERE council_id = council.id) AS meetings
      FROM unoa.council JOIN unoa.scope ON scope.id = council.scope_id
      WHERE unoa.scope_within(council.scope_id, $1) ORDER BY council.archived_at NULLS FIRST, council.name`, [scopeId]),
  ]);
  return { scope: { id: scopeId, label: label.rows[0]?.label ?? '' }, rights: granted, councils: councils.rows };
}

async function councilOf(store: Queryable, id: string) {
  const { rows } = await store.query<{ id: string; scope_id: string; name: string; kind: string; quorum_percent: number; majority: Majority; archived_at: Date | null; scope_label: string; time_zone: string | null }>(`
    SELECT council.*, scope.label AS scope_label, scope.time_zone FROM unoa.council JOIN unoa.scope ON scope.id = council.scope_id WHERE council.id = $1`, [id]);
  ensure(rows[0], 404, 'Conseil introuvable');
  return rows[0];
}

async function membership(store: Queryable, actor: string, councilId: string, on = 'current_date') {
  const { rows } = await store.query<{ id: string; office: string; voting: boolean }>(`
    SELECT id, office, voting FROM unoa.council_member WHERE council_id = $1 AND account_id = $2
      AND starts_on <= ${on} AND (ends_on IS NULL OR ends_on > ${on}) ORDER BY voting DESC LIMIT 1`, [councilId, actor]);
  return rows[0] ?? null;
}

export async function councilDetails(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const council = await councilOf(store, uuid(id));
  const granted = await rights(store, actor, council.scope_id);
  const member = await membership(store, actor, council.id);
  ensure(granted?.read || member, 403, 'Conseil inaccessible');
  const [members, meetings, delegations, candidates] = await Promise.all([
    store.query<{ id: string; account_id: string; name: string | null; office: string; voting: boolean; starts_on: string; ends_on: string | null }>(`
      SELECT member.id, member.account_id, account.display_name AS name, member.office, member.voting, member.starts_on::text, member.ends_on::text
      FROM unoa.council_member AS member JOIN unoa.account ON account.id = member.account_id
      WHERE member.council_id = $1 ORDER BY (member.ends_on IS NULL OR member.ends_on > current_date) DESC, member.office, account.display_name`, [council.id]),
    store.query<{ id: string; title: string; scheduled_at: Date; place: string; state: string; agenda_version: number }>(
      'SELECT id, title, scheduled_at, place, state, agenda_version FROM unoa.meeting WHERE council_id = $1 ORDER BY scheduled_at DESC LIMIT 100', [council.id]),
    store.query<{ id: string; name: string | null; starts_on: string; ends_on: string; reason: string }>(`
      SELECT delegation.id, account.display_name AS name, delegation.starts_on::text, delegation.ends_on::text, delegation.reason
      FROM unoa.signature_delegation AS delegation JOIN unoa.council_member AS member ON member.id = delegation.delegate_member
      JOIN unoa.account ON account.id = member.account_id WHERE delegation.council_id = $1 ORDER BY delegation.starts_on DESC`, [council.id]),
    granted?.manage ? store.query<{ id: string; display_name: string | null }>('SELECT id, display_name FROM unoa.iam_accounts($1, $2, NULL) WHERE disabled_at IS NULL',
      [actor, council.scope_id]).catch(() => ({ rows: [] })) : Promise.resolve({ rows: [] as { id: string; display_name: string | null }[] }),
  ]);
  return { council, rights: granted, member, members: members.rows, meetings: meetings.rows, delegations: delegations.rows, candidates: candidates.rows };
}

async function meetingOf(store: Queryable, id: string, lock = false) {
  const { rows } = await store.query<{ id: string; council_id: string; title: string; scheduled_at: Date; place: string; state: string; agenda_version: number; created_by: string }>(
    `SELECT * FROM unoa.meeting WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  ensure(rows[0], 404, 'Séance introuvable');
  return rows[0];
}

async function quorum(store: Queryable, meetingId: string) {
  const { rows } = await store.query<{ in_office: number; present: number }>(`
    SELECT count(*)::int AS in_office, count(*) FILTER (WHERE attendance.present)::int AS present
    FROM unoa.meeting JOIN unoa.council_member AS member ON member.council_id = meeting.council_id AND member.voting
      AND member.starts_on <= meeting.scheduled_at::date AND (member.ends_on IS NULL OR member.ends_on > meeting.scheduled_at::date)
    LEFT JOIN unoa.meeting_attendance AS attendance ON attendance.meeting_id = meeting.id AND attendance.member_id = member.id
    WHERE meeting.id = $1`, [meetingId]);
  return rows[0];
}

export async function meetingDetails(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const meeting = await meetingOf(store, uuid(id));
  const council = await councilOf(store, meeting.council_id);
  const granted = await rights(store, actor, council.scope_id);
  const member = await membership(store, actor, council.id);
  ensure(granted?.read || member, 403, 'Séance inaccessible');
  const [items, attendance, decisions, minutes, documents, appeals, counts] = await Promise.all([
    store.query<{ id: string; ordinal: number; title: string; description: string | null; kind: string; added_in_version: number; withdrawn_in_version: number | null;
      vote_state: string; votes_for: number; votes_against: number; votes_abstain: number; my_vote: string | null; my_conflict: boolean; conflicts: number }>(`
      SELECT item.*, (SELECT count(*)::int FROM unoa.council_vote WHERE item_id = item.id AND choice = 'for') AS votes_for,
        (SELECT count(*)::int FROM unoa.council_vote WHERE item_id = item.id AND choice = 'against') AS votes_against,
        (SELECT count(*)::int FROM unoa.council_vote WHERE item_id = item.id AND choice = 'abstain') AS votes_abstain,
        (SELECT choice FROM unoa.council_vote WHERE item_id = item.id AND member_id = $2) AS my_vote,
        EXISTS (SELECT 1 FROM unoa.conflict_declaration WHERE item_id = item.id AND member_id = $2) AS my_conflict,
        (SELECT count(*)::int FROM unoa.conflict_declaration WHERE item_id = item.id) AS conflicts
      FROM unoa.agenda_item AS item WHERE item.meeting_id = $1 ORDER BY item.ordinal`, [meeting.id, member?.id ?? null]),
    store.query<{ member_id: string; name: string | null; office: string; voting: boolean; present: boolean | null }>(`
      SELECT member.id AS member_id, account.display_name AS name, member.office, member.voting, attendance.present
      FROM unoa.council_member AS member JOIN unoa.account ON account.id = member.account_id
      LEFT JOIN unoa.meeting_attendance AS attendance ON attendance.member_id = member.id AND attendance.meeting_id = $1
      WHERE member.council_id = $2 AND member.starts_on <= $3::date AND (member.ends_on IS NULL OR member.ends_on > $3::date)
      ORDER BY member.office, account.display_name`, [meeting.id, council.id, meeting.scheduled_at]),
    store.query<{ id: string; item_id: string; outcome: string; votes_for: number; votes_against: number; votes_abstain: number; present: number; text: string;
      effective_on: string | null; public_summary: string | null; published_at: Date | null }>(`
      SELECT decision.id, decision.item_id, decision.outcome, decision.votes_for, decision.votes_against, decision.votes_abstain, decision.present,
        decision.text, decision.effective_on::text, decision.public_summary, decision.published_at
      FROM unoa.council_decision AS decision JOIN unoa.agenda_item AS item ON item.id = decision.item_id WHERE item.meeting_id = $1`, [meeting.id]),
    store.query<{ body: string; drafted_by: string; signed_by: string | null; signed_at: Date | null; sha256: string | null; signer: string | null }>(`
      SELECT minutes.body, minutes.drafted_by, minutes.signed_by, minutes.signed_at, minutes.sha256, account.display_name AS signer
      FROM unoa.meeting_minutes AS minutes LEFT JOIN unoa.account ON account.id = minutes.signed_by WHERE minutes.meeting_id = $1`, [meeting.id]),
    store.query<{ id: string; title: string; url: string; added_at: Date }>('SELECT id, title, url, added_at FROM unoa.meeting_document WHERE meeting_id = $1 ORDER BY added_at', [meeting.id]),
    store.query<{ id: string; decision_id: string; reason: string; state: string; filed_at: Date; ruling: string | null; filed_by: string }>(`
      SELECT appeal.id, appeal.decision_id, appeal.reason, appeal.state, appeal.filed_at, appeal.ruling, appeal.filed_by FROM unoa.decision_appeal AS appeal
      JOIN unoa.council_decision AS decision ON decision.id = appeal.decision_id JOIN unoa.agenda_item AS item ON item.id = decision.item_id
      WHERE item.meeting_id = $1 ORDER BY appeal.filed_at`, [meeting.id]),
    quorum(store, meeting.id),
  ]);
  const signer = await canSign(store, actor, council.id);
  return {
    meeting, council, rights: granted, member, items: items.rows, attendance: attendance.rows, decisions: decisions.rows, minutes: minutes.rows[0] ?? null,
    documents: documents.rows, appeals: appeals.rows, canSign: signer,
    quorum: { ...counts, required: requiredPresent(counts.in_office, council.quorum_percent), reached: quorumReached(counts.present, counts.in_office, council.quorum_percent) },
  };
}

// The chair in office, or a delegate whose delegation covers today.
async function canSign(store: Queryable, actor: string, councilId: string) {
  const { rows } = await store.query<{ ok: boolean }>(`
    SELECT EXISTS (SELECT 1 FROM unoa.council_member WHERE council_id = $1 AND account_id = $2 AND office = 'chair'
        AND starts_on <= current_date AND (ends_on IS NULL OR ends_on > current_date))
      OR EXISTS (SELECT 1 FROM unoa.signature_delegation AS delegation JOIN unoa.council_member AS member ON member.id = delegation.delegate_member
        WHERE delegation.council_id = $1 AND member.account_id = $2 AND current_date BETWEEN delegation.starts_on AND delegation.ends_on) AS ok`, [councilId, actor]);
  return rows[0].ok;
}

export async function myCouncils(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ council_id: string; name: string; office: string; voting: boolean; scope_label: string;
    next_meeting: string | null; next_title: string | null; next_at: Date | null }>(`
    SELECT council.id AS council_id, council.name, member.office, member.voting, scope.label AS scope_label,
      meeting.id AS next_meeting, meeting.title AS next_title, meeting.scheduled_at AS next_at
    FROM unoa.council_member AS member JOIN unoa.council ON council.id = member.council_id JOIN unoa.scope ON scope.id = council.scope_id
    LEFT JOIN LATERAL (SELECT id, title, scheduled_at FROM unoa.meeting WHERE council_id = council.id AND state IN ('convened', 'opened')
      ORDER BY scheduled_at LIMIT 1) AS meeting ON true
    WHERE member.account_id = $1 AND member.starts_on <= current_date AND (member.ends_on IS NULL OR member.ends_on > current_date)
    ORDER BY council.name`, [actor]);
  return rows;
}

async function notifyMembers(store: Queryable, councilId: string, scopeId: string, event: string, values: Record<string, string>, link: string, correlation: string, except?: string) {
  const { rows } = await store.query<{ account_id: string }>(`SELECT DISTINCT account_id FROM unoa.council_member WHERE council_id = $1
    AND (ends_on IS NULL OR ends_on > current_date) AND account_id <> coalesce($2::uuid, '00000000-0000-0000-0000-000000000000')`, [councilId, except ?? null]);
  await dispatch(store, { event, scopeId, recipients: rows.map(row => row.account_id), values, link, correlation });
}

export async function govAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.gov.' + action, async store => {
    if (action === 'councils') {
      const scopeId = uuid(input.scopeId);
      await require(store, actor, scopeId, 'manage');
      const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.council(scope_id, name, kind, quorum_percent, majority, created_by)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [scopeId, boundedText(input.name, 200, 'Nom'), boundedText(input.kind, 120, 'Nature'),
        integer(input.quorumPercent ?? 50, 'Quorum', 1, 100), choice(input.majority ?? 'simple', majorities, 'Majorité'), actor]);
      await audit(store, actor, scopeId, 'gov.council_created', correlation, rows[0].id);
      return { id: rows[0].id, scopeId, councilId: rows[0].id };
    }
    if (['members', 'end-member', 'delegations'].includes(action)) {
      const council = await councilOf(store, uuid(input.councilId));
      await require(store, actor, council.scope_id, 'manage');
      if (action === 'members') {
        const office = choice(input.office ?? 'member', ['chair', 'secretary', 'member', 'guest'] as const, 'Fonction');
        const startsOn = day(input.startsOn, 'Début du mandat');
        const endsOn = optional(input.endsOn, value => day(value, 'Fin du mandat'));
        const accountId = uuid(input.accountId);
        const { rows: overlap } = await store.query(`SELECT 1 FROM unoa.council_member WHERE council_id = $1 AND account_id = $2
          AND (ends_on IS NULL OR ends_on > $3::date) AND ($4::date IS NULL OR starts_on < $4::date)`, [council.id, accountId, startsOn, endsOn]);
        ensure(!overlap[0], 409, 'Un mandat en cours existe déjà pour cette personne');
        await store.query(`INSERT INTO unoa.council_member(council_id, account_id, office, voting, starts_on, ends_on, appointed_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`, [council.id, accountId, office, office !== 'guest' && flag(input.voting ?? true), startsOn, endsOn, actor]);
      } else if (action === 'end-member') {
        const updated = await store.query(`UPDATE unoa.council_member SET ends_on = $3 WHERE id = $1 AND council_id = $2 AND (ends_on IS NULL OR ends_on > $3)
          AND starts_on < $3`, [uuid(input.memberId), council.id, day(input.endsOn, 'Fin du mandat')]);
        ensure(updated.rowCount === 1, 409, 'Mandat introuvable ou déjà terminé');
      } else {
        const delegate = uuid(input.memberId);
        const { rows } = await store.query('SELECT 1 FROM unoa.council_member WHERE id = $1 AND council_id = $2 AND voting AND (ends_on IS NULL OR ends_on > current_date)', [delegate, council.id]);
        ensure(rows[0], 422, 'La délégation de signature va à un membre votant en fonction');
        await store.query(`INSERT INTO unoa.signature_delegation(council_id, delegate_member, starts_on, ends_on, reason, granted_by) VALUES ($1, $2, $3, $4, $5, $6)`,
          [council.id, delegate, day(input.startsOn, 'Début'), day(input.endsOn, 'Fin'), boundedText(input.reason, 500, 'Motif'), actor]);
      }
      await audit(store, actor, council.scope_id, 'gov.' + action.replace('-', '_'), correlation, council.id);
      return { councilId: council.id, scopeId: council.scope_id };
    }
    if (action === 'meetings') {
      const council = await councilOf(store, uuid(input.councilId));
      await require(store, actor, council.scope_id, 'secretary');
      ensure(!council.archived_at, 409, 'Conseil archivé');
      const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.meeting(council_id, title, scheduled_at, place, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [council.id, boundedText(input.title, 200, 'Intitulé'), utcTime(input.scheduledAt), boundedText(input.place, 500, 'Lieu ou lien'), actor]);
      await audit(store, actor, council.scope_id, 'gov.meeting_created', correlation, rows[0].id);
      return { meetingId: rows[0].id, scopeId: council.scope_id };
    }
    // ----- actions on a meeting
    const meeting = await meetingOf(store, uuid(input.meetingId), true);
    const council = await councilOf(store, meeting.council_id);
    const link = '/conseils?seance=' + meeting.id;
    const values = { council: council.name, title: meeting.title, start: formatInZone(meeting.scheduled_at, council.time_zone ?? 'UTC') };
    const secretary = async () => require(store, actor, council.scope_id, 'secretary');
    const done = async (event: string, resource: string | null = meeting.id) => {
      await audit(store, actor, council.scope_id, 'gov.' + event, correlation, resource);
      return { meetingId: meeting.id, scopeId: council.scope_id };
    };
    if (action === 'items' || action === 'withdraw-item') {
      await secretary();
      ensure(['draft', 'convened'].includes(meeting.state), 409, 'L’ordre du jour est figé une fois la séance ouverte');
      const version = meeting.state === 'convened' ? meeting.agenda_version + 1 : meeting.agenda_version;
      if (action === 'items') {
        const { rows } = await store.query<{ next: number }>('SELECT coalesce(max(ordinal), 0) + 1 AS next FROM unoa.agenda_item WHERE meeting_id = $1', [meeting.id]);
        await store.query(`INSERT INTO unoa.agenda_item(meeting_id, ordinal, title, description, kind, added_in_version) VALUES ($1, $2, $3, $4, $5, $6)`,
          [meeting.id, rows[0].next, boundedText(input.title, 300, 'Point'), optional(input.description, text(4000, 'Exposé')),
            choice(input.kind ?? 'vote', ['information', 'vote'] as const, 'Nature'), version]);
      } else {
        const updated = await store.query('UPDATE unoa.agenda_item SET withdrawn_in_version = $3 WHERE id = $1 AND meeting_id = $2 AND withdrawn_in_version IS NULL',
          [uuid(input.itemId), meeting.id, version]);
        ensure(updated.rowCount === 1, 404, 'Point introuvable');
      }
      if (meeting.state === 'convened') {
        await store.query('UPDATE unoa.meeting SET agenda_version = $2 WHERE id = $1', [meeting.id, version]);
        await notifyMembers(store, council.id, council.scope_id, 'gov.agenda_changed', { ...values, version: String(version) }, link, correlation, actor);
      }
      return done('agenda_changed');
    }
    if (action === 'convene') {
      await secretary();
      ensure(meeting.state === 'draft', 409, 'Séance déjà convoquée');
      const { rows } = await store.query('SELECT 1 FROM unoa.agenda_item WHERE meeting_id = $1 AND withdrawn_in_version IS NULL LIMIT 1', [meeting.id]);
      ensure(rows[0], 422, 'L’ordre du jour est vide');
      await store.query("UPDATE unoa.meeting SET state = 'convened', convened_at = now() WHERE id = $1", [meeting.id]);
      await notifyMembers(store, council.id, council.scope_id, 'gov.convened', values, link, correlation);
      return done('convened');
    }
    if (action === 'attendance') {
      await secretary();
      ensure(['convened', 'opened'].includes(meeting.state), 409, 'Présences tenues pendant la séance');
      const memberId = uuid(input.memberId);
      const { rows } = await store.query('SELECT 1 FROM unoa.council_member WHERE id = $1 AND council_id = $2', [memberId, council.id]);
      ensure(rows[0], 404, 'Membre introuvable');
      await store.query(`INSERT INTO unoa.meeting_attendance(meeting_id, member_id, present, recorded_by) VALUES ($1, $2, $3, $4)
        ON CONFLICT (meeting_id, member_id) DO UPDATE SET present = EXCLUDED.present, recorded_by = EXCLUDED.recorded_by, recorded_at = now()`,
        [meeting.id, memberId, flag(input.present), actor]);
      return done('attendance_recorded', memberId);
    }
    if (action === 'open') {
      await secretary();
      ensure(meeting.state === 'convened', 409, 'Séance non convoquée');
      const counts = await quorum(store, meeting.id);
      ensure(quorumReached(counts.present, counts.in_office, council.quorum_percent), 422,
        `Quorum non atteint : ${counts.present} présent(s) sur ${requiredPresent(counts.in_office, council.quorum_percent)} requis`);
      await store.query("UPDATE unoa.meeting SET state = 'opened', opened_at = now() WHERE id = $1", [meeting.id]);
      return done('opened');
    }
    if (action === 'open-vote' || action === 'close-item') {
      await secretary();
      ensure(meeting.state === 'opened', 409, 'Séance non ouverte');
      const itemId = uuid(input.itemId);
      const { rows: items } = await store.query<{ kind: string; vote_state: string; title: string }>(
        'SELECT kind, vote_state, title FROM unoa.agenda_item WHERE id = $1 AND meeting_id = $2 AND withdrawn_in_version IS NULL FOR UPDATE', [itemId, meeting.id]);
      ensure(items[0], 404, 'Point introuvable');
      if (action === 'open-vote') {
        ensure(items[0].kind === 'vote' && items[0].vote_state === 'pending', 409, 'Vote déjà ouvert ou point d’information');
        await store.query("UPDATE unoa.agenda_item SET vote_state = 'open' WHERE id = $1", [itemId]);
        return done('vote_opened', itemId);
      }
      const counts = await quorum(store, meeting.id);
      ensure(quorumReached(counts.present, counts.in_office, council.quorum_percent), 422, 'Quorum perdu : la délibération ne peut être close');
      const { rows: tally } = await store.query<{ for: number; against: number; abstain: number }>(`
        SELECT count(*) FILTER (WHERE choice = 'for')::int AS for, count(*) FILTER (WHERE choice = 'against')::int AS against,
               count(*) FILTER (WHERE choice = 'abstain')::int AS abstain FROM unoa.council_vote WHERE item_id = $1`, [itemId]);
      const { rows: conflicts } = await store.query<{ total: number }>('SELECT count(*)::int AS total FROM unoa.conflict_declaration WHERE item_id = $1', [itemId]);
      const voters = counts.present - conflicts[0].total;
      const result = items[0].kind === 'information' ? 'noted' : (ensure(items[0].vote_state === 'open', 409, 'Le vote n’est pas ouvert'), outcome(council.majority, tally[0], voters));
      await store.query("UPDATE unoa.agenda_item SET vote_state = 'closed' WHERE id = $1", [itemId]);
      await store.query(`INSERT INTO unoa.council_decision(item_id, outcome, votes_for, votes_against, votes_abstain, present, text, effective_on, recorded_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [itemId, result, tally[0].for, tally[0].against, tally[0].abstain, counts.present,
        boundedText(input.text ?? items[0].title, 4000, 'Texte de la décision'), optional(input.effectiveOn, value => day(value, 'Date d’effet')), actor]);
      return done('decision_recorded', itemId);
    }
    if (action === 'close-meeting') {
      await secretary();
      ensure(meeting.state === 'opened', 409, 'Séance non ouverte');
      const { rows } = await store.query("SELECT 1 FROM unoa.agenda_item WHERE meeting_id = $1 AND withdrawn_in_version IS NULL AND vote_state = 'open' LIMIT 1", [meeting.id]);
      ensure(!rows[0], 409, 'Un vote est encore ouvert');
      await store.query("UPDATE unoa.meeting SET state = 'closed', closed_at = now() WHERE id = $1", [meeting.id]);
      return done('closed');
    }
    if (action === 'minutes') {
      await secretary();
      ensure(meeting.state === 'closed', 409, 'Le procès-verbal suit la clôture de la séance');
      const body = boundedText(input.body, 60000, 'Procès-verbal');
      await store.query(`INSERT INTO unoa.meeting_minutes(meeting_id, body, drafted_by) VALUES ($1, $2, $3)
        ON CONFLICT (meeting_id) DO UPDATE SET body = EXCLUDED.body, drafted_by = EXCLUDED.drafted_by, drafted_at = now()`, [meeting.id, body, actor]);
      return done('minutes_drafted');
    }
    if (action === 'sign') {
      ensure(await canSign(store, actor, council.id), 403, 'La signature revient au président ou à son délégataire');
      const { rows } = await store.query<{ body: string; drafted_by: string; signed_at: Date | null }>('SELECT body, drafted_by, signed_at FROM unoa.meeting_minutes WHERE meeting_id = $1 FOR UPDATE', [meeting.id]);
      ensure(rows[0], 422, 'Aucun procès-verbal rédigé');
      ensure(!rows[0].signed_at, 409, 'Procès-verbal déjà signé');
      ensure(rows[0].drafted_by !== actor, 403, 'Le signataire est une autre personne que le rédacteur');
      await store.query('UPDATE unoa.meeting_minutes SET signed_by = $2, signed_at = now(), sha256 = $3 WHERE meeting_id = $1',
        [meeting.id, actor, createHash('sha256').update(rows[0].body).digest('hex')]);
      await notifyMembers(store, council.id, council.scope_id, 'gov.minutes_signed', values, link, correlation, actor);
      return done('minutes_signed');
    }
    if (action === 'publish') {
      await require(store, actor, council.scope_id, 'publish');
      const { rows } = await store.query<{ signed_at: Date | null }>('SELECT signed_at FROM unoa.meeting_minutes WHERE meeting_id = $1', [meeting.id]);
      ensure(rows[0]?.signed_at, 422, 'La publication suit la signature du procès-verbal');
      const updated = await store.query(`UPDATE unoa.council_decision AS decision SET public_summary = $3, published_by = $4, published_at = now()
        FROM unoa.agenda_item AS item WHERE decision.id = $1 AND item.id = decision.item_id AND item.meeting_id = $2 AND decision.published_at IS NULL`,
        [uuid(input.decisionId), meeting.id, boundedText(input.summary, 2000, 'Résumé public'), actor]);
      ensure(updated.rowCount === 1, 409, 'Décision introuvable ou déjà publiée');
      return done('decision_published', String(input.decisionId));
    }
    if (action === 'documents') {
      await secretary();
      await store.query('INSERT INTO unoa.meeting_document(meeting_id, title, url, added_by) VALUES ($1, $2, $3, $4)',
        [meeting.id, boundedText(input.title, 200, 'Titre'), https(input.url, 'Adresse du document'), actor]);
      return done('document_added');
    }
    if (action === 'archive') {
      await secretary();
      const { rows } = await store.query('SELECT 1 FROM unoa.meeting_minutes WHERE meeting_id = $1 AND signed_at IS NOT NULL', [meeting.id]);
      ensure(meeting.state === 'closed' && rows[0], 422, 'Archivage après clôture et signature du procès-verbal');
      await store.query("UPDATE unoa.meeting SET state = 'archived' WHERE id = $1", [meeting.id]);
      return done('archived');
    }
    // ----- the member's own acts
    const member = await membership(store, actor, council.id, `'${new Date(meeting.scheduled_at).toISOString().slice(0, 10)}'::date`);
    if (action === 'vote' || action === 'conflict') {
      ensure(member, 403, 'Réservé aux membres du conseil');
      const itemId = uuid(input.itemId);
      if (action === 'conflict') {
        const { rows } = await store.query('SELECT 1 FROM unoa.council_vote WHERE item_id = $1 AND member_id = $2', [itemId, member.id]);
        ensure(!rows[0], 409, 'Conflit à déclarer avant de voter');
        await store.query('INSERT INTO unoa.conflict_declaration(item_id, member_id, reason) SELECT $1, $2, $3 FROM unoa.agenda_item WHERE id = $1 AND meeting_id = $4',
          [itemId, member.id, boundedText(input.reason, 1000, 'Motif'), meeting.id]);
        return done('conflict_declared', itemId);
      }
      await store.query('INSERT INTO unoa.council_vote(item_id, member_id, choice) VALUES ($1, $2, $3)',
        [itemId, member.id, choice(input.choice, ['for', 'against', 'abstain'] as const, 'Vote')]).catch(error => {
        if (error?.code === '23505') throw new Problem(409, 'Vote déjà enregistré');
        throw error;
      });
      return done('vote_cast', itemId);
    }
    if (action === 'appeal') {
      ensure(member || (await rights(store, actor, council.scope_id))?.read, 403, 'Recours réservé aux membres et responsables');
      await store.query(`INSERT INTO unoa.decision_appeal(decision_id, filed_by, reason) SELECT decision.id, $2, $3 FROM unoa.council_decision AS decision
        JOIN unoa.agenda_item AS item ON item.id = decision.item_id WHERE decision.id = $1 AND item.meeting_id = $4`,
        [uuid(input.decisionId), actor, boundedText(input.reason, 4000, 'Motif du recours'), meeting.id]);
      return done('appeal_filed', String(input.decisionId));
    }
    if (action === 'rule-appeal') {
      await require(store, actor, council.scope_id, 'publish');
      const updated = await store.query(`UPDATE unoa.decision_appeal SET state = $2, ruled_by = $3, ruled_at = now(), ruling = $4
        WHERE id = $1 AND state = 'submitted' AND filed_by <> $3`, [uuid(input.appealId), choice(input.ruling, ['upheld', 'granted'] as const, 'Décision'),
        actor, boundedText(input.note, 2000, 'Motif')]);
      ensure(updated.rowCount === 1, 409, 'Recours introuvable, déjà tranché, ou formé par vous-même');
      return done('appeal_ruled', String(input.appealId));
    }
    throw new Problem(404, 'Opération inconnue');
  });
}

export async function publicDecisions(settings: IamSettings, siteId: string) {
  const { rows } = await database(settings).query<{ council: string; meeting_date: Date; title: string; summary: string; outcome: string; effective_on: string | null; published_at: Date }>(
    'SELECT council, meeting_date, title, summary, outcome, effective_on::text, published_at FROM unoa.public_decisions($1)', [siteId]);
  return rows;
}
