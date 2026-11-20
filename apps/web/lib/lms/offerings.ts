import 'server-only';
// Offerings deliver a published course version to a cohort. Access follows the
// membership relation (learner, teacher, tutor) or the lms.manage permission.
import type { PoolClient } from 'pg';
import { lessonAccess } from '@unoa/domain/learning';
import { zonedToUtc } from '@unoa/domain/time';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, choice, day, ensure, flag, https, integer, language, numeric, optional, optionalText, Problem, text, timeZone, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { lockCourseVersion, versionContent, type CourseVersionRow } from './studio';

export const memberRoles = ['learner', 'teacher', 'tutor'] as const;

export async function createOffering(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const versionId = uuid(id);
  const label = boundedText(input.label, 200, 'Promotion ou groupe');
  const zone = timeZone(input.timeZone);
  const startsOn = day(input.startsOn, 'Début');
  const endsOn = day(input.endsOn, 'Fin');
  ensure(endsOn >= startsOn, 400, 'Période incohérente');
  return transaction(settings, 'unoa.lms.version.' + versionId, async store => {
    const { version, course } = await lockCourseVersion(store, actor, versionId, 'manage');
    ensure(version.state === 'published', 422, 'Une offre porte sur une version publiée');
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.course_offering(course_version_id, owner_scope_id, label, time_zone, starts_on, ends_on, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
    `, [versionId, course.owner_scope_id, label, zone, startsOn, endsOn, actor]);
    await audit(store, actor, course.owner_scope_id, 'lms.offering_created', correlation, rows[0].id);
    return { id: rows[0].id };
  });
}

export interface OfferingRow {
  id: string; label: string; state: string; time_zone: string; starts_on: string; ends_on: string;
  course_version_id: string; owner_scope_id: string; course_id: string; course_code: string; title: string; language: string;
  role: 'learner' | 'teacher' | 'tutor' | null; manage: boolean;
}

export async function offering(store: Queryable, actor: string, offeringId: string) {
  const { rows } = await store.query<OfferingRow>(`
    SELECT offering.id, offering.label, offering.state, offering.time_zone, offering.starts_on::text, offering.ends_on::text,
           offering.course_version_id, offering.owner_scope_id, version.course_id, course.code AS course_code, version.title,
           version.language, unoa.offering_role(offering.id, $1) AS role,
           unoa.has_scope_permission($1, 'lms.manage', offering.owner_scope_id) AS manage
    FROM unoa.course_offering AS offering
    JOIN unoa.course_version AS version ON version.id = offering.course_version_id
    JOIN unoa.course ON course.id = version.course_id
    WHERE offering.id = $2
  `, [actor, offeringId]);
  const found = rows[0];
  ensure(found && (found.role || found.manage), 403, 'Vous n’êtes pas membre de cette offre');
  return found;
}

export const canTeach = (item: OfferingRow) => item.role === 'teacher' || item.manage;
export const canModerate = (item: OfferingRow) => item.role === 'teacher' || item.role === 'tutor' || item.manage;

export async function offeringFor(store: Queryable, actor: string, offeringId: string) {
  return offering(store, actor, offeringId);
}

export async function manageMember(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const offeringId = uuid(id);
  const accountId = uuid(input.accountId);
  const role = choice(input.role, memberRoles, 'Rôle');
  const remove = flag(input.remove);
  return transaction(settings, 'unoa.lms.offering.' + offeringId, async store => {
    const item = await offering(store, actor, offeringId);
    ensure(item.manage, 403, 'Gestion des membres non autorisée');
    if (remove) {
      const removed = await store.query(`
        UPDATE unoa.offering_member SET removed_at = now(), removed_by = $4
        WHERE offering_id = $1 AND account_id = $2 AND role = $3 AND removed_at IS NULL
      `, [offeringId, accountId, role, actor]);
      ensure(removed.rowCount === 1, 404, 'Membre introuvable');
    } else {
      ensure(item.state === 'open', 409, 'Offre close');
      await store.query(`
        INSERT INTO unoa.offering_member(offering_id, account_id, role, display_name, added_by) VALUES ($1, $2, $3, $4, $5)
      `, [offeringId, accountId, role, optional(input.displayName, text(160, 'Nom affiché')), actor]);
    }
    await audit(store, actor, item.owner_scope_id, remove ? 'lms.member_removed' : 'lms.member_added', correlation, accountId);
    return { id: offeringId };
  });
}

export async function closeOffering(settings: IamSettings, actor: string, id: string, correlation: string) {
  const offeringId = uuid(id);
  return transaction(settings, 'unoa.lms.offering.' + offeringId, async store => {
    const item = await offering(store, actor, offeringId);
    ensure(item.manage, 403, 'Clôture non autorisée');
    ensure(item.state === 'open', 409, 'Offre déjà close');
    await store.query("UPDATE unoa.course_offering SET state = 'closed' WHERE id = $1", [offeringId]);
    await audit(store, actor, item.owner_scope_id, 'lms.offering_closed', correlation, offeringId);
    return { id: offeringId };
  });
}

export async function myOfferings(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string; title: string; role: string; state: string; time_zone: string; next_session: Date | null; progress: number; lessons: number }>(`
    SELECT offering.id, offering.label, version.title, unoa.offering_role(offering.id, $1) AS role, offering.state, offering.time_zone,
      (SELECT min(starts_at) FROM unoa.live_session WHERE offering_id = offering.id AND state = 'scheduled' AND ends_at > now()) AS next_session,
      (SELECT count(*)::int FROM unoa.lesson_progress WHERE offering_id = offering.id AND account_id = $1) AS progress,
      (SELECT count(*)::int FROM unoa.lesson WHERE version_id = version.id) AS lessons
    FROM unoa.course_offering AS offering JOIN unoa.course_version AS version ON version.id = offering.course_version_id
    WHERE EXISTS (SELECT 1 FROM unoa.offering_member WHERE offering_id = offering.id AND account_id = $1 AND removed_at IS NULL)
    ORDER BY offering.state DESC, offering.starts_on DESC LIMIT 200
  `, [actor]);
  return rows;
}

export async function offeringView(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const item = await offering(store, actor, uuid(id));
  const [content, version, progress, dues, sessions, members, threads] = await Promise.all([
    versionContent(store, item.course_version_id),
    store.query<CourseVersionRow>('SELECT * FROM unoa.course_version WHERE id = $1', [item.course_version_id]),
    store.query<{ lesson_id: string }>('SELECT lesson_id FROM unoa.lesson_progress WHERE offering_id = $1 AND account_id = $2', [item.id, actor]),
    store.query<{ lesson_id: string; due_at: Date }>('SELECT lesson_id, due_at FROM unoa.lesson_due WHERE offering_id = $1', [item.id]),
    store.query<{
      id: string; title: string; agenda: string | null; starts_at: Date; ends_at: Date; state: string; cancel_reason: string | null;
      recording_planned: boolean; replay_url: string | null; consent: string | null; resources: { title: string; url: string }[];
    }>(`
      SELECT session.id, session.title, session.agenda, session.starts_at, session.ends_at, session.state, session.cancel_reason,
             session.recording_planned, session.replay_url,
             (SELECT decision FROM unoa.live_consent WHERE session_id = session.id AND account_id = $2) AS consent,
             coalesce((SELECT jsonb_agg(jsonb_build_object('title', title, 'url', url) ORDER BY shared_at)
               FROM unoa.live_resource WHERE session_id = session.id), '[]') AS resources
      FROM unoa.live_session AS session WHERE session.offering_id = $1 ORDER BY session.starts_at LIMIT 300
    `, [item.id, actor]),
    canModerate(item) ? store.query<{ account_id: string; role: string; display_name: string | null }>(`
      SELECT account_id, role, display_name FROM unoa.offering_member WHERE offering_id = $1 AND removed_at IS NULL ORDER BY role, display_name
    `, [item.id]) : Promise.resolve({ rows: [] as { account_id: string; role: string; display_name: string | null }[] }),
    store.query<{ id: string; title: string; created_at: Date; locked_at: Date | null; posts: number }>(`
      SELECT thread.id, thread.title, thread.created_at, thread.locked_at,
        (SELECT count(*)::int FROM unoa.forum_post WHERE thread_id = thread.id AND hidden_at IS NULL) AS posts
      FROM unoa.forum_thread AS thread WHERE thread.offering_id = $1 ORDER BY thread.created_at DESC LIMIT 100
    `, [item.id]),
  ]);
  const completed = new Set(progress.rows.map(row => row.lesson_id));
  const access = lessonAccess(content.modules.map(module => ({
    accessMode: module.access_mode,
    lessons: content.lessons.filter(lesson => lesson.module_id === module.id).map(lesson => ({ id: lesson.id, requires: lesson.requires_lesson_id })),
  })), completed);
  return {
    offering: item, version: version.rows[0], ...content, completed: [...completed],
    access: Object.fromEntries([...access].map(([key, value]) => [key, canTeach(item) ? { open: true } : value])),
    dues: dues.rows, sessions: sessions.rows, members: members.rows, threads: threads.rows,
  };
}

export async function lessonView(settings: IamSettings, actor: string, id: string, lessonId: string) {
  const view = await offeringView(settings, actor, id);
  const lesson = view.lessons.find(item => item.id === uuid(lessonId));
  ensure(lesson, 404, 'Leçon introuvable');
  ensure(view.access[lesson.id]?.open, 423, 'Leçon verrouillée');
  const { rows } = await database(settings).query<{ body: string | null; bookmarked: boolean }>(
    'SELECT body, bookmarked FROM unoa.learner_note WHERE offering_id = $1 AND lesson_id = $2 AND account_id = $3',
    [view.offering.id, lesson.id, actor],
  );
  return { ...view, lesson, note: rows[0] ?? null };
}

export async function lessonInOffering(store: Queryable, item: OfferingRow, lessonId: string) {
  const { rows } = await store.query('SELECT 1 FROM unoa.lesson WHERE id = $1 AND version_id = $2', [lessonId, item.course_version_id]);
  ensure(rows[0], 404, 'Leçon introuvable dans cette offre');
}

export async function completeLesson(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const offeringId = uuid(id);
  const lessonId = uuid(input.lessonId);
  const view = await offeringView(settings, actor, offeringId);
  ensure(view.offering.role === 'learner', 403, 'La progression concerne les apprenants');
  ensure(view.access[lessonId]?.open, 423, 'Leçon verrouillée');
  return transaction(settings, 'unoa.lms.progress.' + offeringId + actor, async store => {
    await lessonInOffering(store, view.offering, lessonId);
    await store.query(`
      INSERT INTO unoa.lesson_progress(offering_id, lesson_id, account_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
    `, [offeringId, lessonId, actor]);
    await audit(store, actor, view.offering.owner_scope_id, 'lms.lesson_completed', correlation, lessonId);
    return { id: offeringId };
  });
}

export async function saveNote(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const offeringId = uuid(id);
  const lessonId = uuid(input.lessonId);
  const body = optional(input.body, text(20000, 'Note'));
  return transaction(settings, 'unoa.lms.note.' + offeringId + actor, async store => {
    const item = await offering(store, actor, offeringId);
    ensure(item.role, 403, 'Notes réservées aux membres');
    await lessonInOffering(store, item, lessonId);
    await store.query(`
      INSERT INTO unoa.learner_note(offering_id, lesson_id, account_id, body, bookmarked) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (offering_id, lesson_id, account_id) DO UPDATE SET body = excluded.body, bookmarked = excluded.bookmarked, updated_at = now()
    `, [offeringId, lessonId, actor, body, flag(input.bookmarked)]);
    return { id: offeringId };
  });
}

export async function setDue(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const offeringId = uuid(id);
  const lessonId = uuid(input.lessonId);
  return transaction(settings, 'unoa.lms.offering.' + offeringId, async store => {
    const item = await offering(store, actor, offeringId);
    ensure(canTeach(item), 403, 'Échéances réservées à l’équipe pédagogique');
    // The due date is typed in the offering's own time zone.
    const dueAt = zonedToUtc(String(input.dueAt ?? ''), item.time_zone);
    ensure(dueAt, 400, 'Échéance invalide');
    await lessonInOffering(store, item, lessonId);
    await store.query(`
      INSERT INTO unoa.lesson_due(offering_id, lesson_id, due_at, set_by) VALUES ($1, $2, $3, $4)
      ON CONFLICT (offering_id, lesson_id) DO UPDATE SET due_at = excluded.due_at, set_by = excluded.set_by
    `, [offeringId, lessonId, dueAt, actor]);
    await audit(store, actor, item.owner_scope_id, 'lms.due_set', correlation, lessonId);
    return { id: offeringId };
  });
}

