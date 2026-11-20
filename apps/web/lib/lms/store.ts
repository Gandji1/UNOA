import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { lessonAccess, parseChapters } from '@unoa/domain/learning';
import { zonedToUtc } from '@unoa/domain/time';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, ConfigProblem, numeric, requireConfig, uuid, type Input } from '@/lib/config/validation';
import { language } from '@/lib/territory/validation';
import { flag } from '@/lib/org/store';
import { audit, optionalText, transaction, type Queryable } from '@/lib/studio/db';

export const lessonKinds = ['page', 'video', 'audio', 'document', 'link', 'activity'] as const;
export const memberRoles = ['learner', 'teacher', 'tutor'] as const;
type Right = 'read' | 'write' | 'review' | 'manage';

const optional = <T>(input: unknown, read: (value: unknown) => T) => optionalText(input) === null ? null : read(input);
const text = (limit: number, label: string) => (value: unknown) => boundedText(value, limit, label);
const timeZones = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);

function https(input: unknown, label: string) {
  requireConfig(typeof input === 'string' && /^https:\/\/[^\s]+$/.test(input) && input.length <= 2000, 400, label + ' : adresse HTTPS requise');
  try { new URL(input); } catch { requireConfig(false, 400, label + ' invalide'); }
  return input;
}

function integer(input: unknown, label: string, minimum: number, maximum: number) {
  const value = numeric(input);
  requireConfig(Number.isInteger(value) && value >= minimum && value <= maximum, 400, label + ' invalide');
  return value;
}

function choice<T extends string>(input: unknown, values: readonly T[], label: string): T {
  requireConfig(values.includes(input as T), 400, label + ' invalide');
  return input as T;
}

function day(input: unknown, label: string) {
  requireConfig(typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input) && !Number.isNaN(Date.parse(input + 'T00:00:00Z')), 400, label + ' invalide');
  return input;
}

// ------------------------------------------------------------------ studio

export async function lmsContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string; nature: string }>(`
    SELECT scope.id, scope.label, kind.nature FROM unoa.scope
    JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE kind.nature IN ('institution', 'academic_unit') AND unoa.has_scope_permission($1, 'lms.read', scope.id)
    ORDER BY kind.nature DESC, scope.label LIMIT 200
  `, [actor]);
  return rows;
}

async function rights(store: Queryable, actor: string, scope: string) {
  const { rows } = await store.query<Record<Right, boolean>>(`
    SELECT unoa.has_scope_permission($1, 'lms.read', $2) AS read, unoa.has_scope_permission($1, 'lms.write', $2) AS write,
           unoa.has_scope_permission($1, 'lms.review', $2) AS review, unoa.has_scope_permission($1, 'lms.manage', $2) AS manage
  `, [actor, scope]);
  return rows[0];
}

async function courseOwner(store: Queryable, actor: string, courseId: string, right: Right) {
  const { rows } = await store.query<{ id: string; code: string; title: string; owner_scope_id: string; owner_label: string }>(`
    SELECT course.id, course.code, course.title, course.owner_scope_id, owner.label AS owner_label
    FROM unoa.course JOIN unoa.scope AS owner ON owner.id = course.owner_scope_id WHERE course.id = $1
  `, [courseId]);
  requireConfig(rows[0], 404, 'Cours introuvable');
  const granted = await rights(store, actor, rows[0].owner_scope_id);
  requireConfig(granted[right], 403, 'Action non autorisée sur ce cours');
  return { course: rows[0], rights: granted };
}

export async function lmsOverview(settings: IamSettings, actor: string, scopeId: string) {
  const store = database(settings);
  const granted = await rights(store, actor, uuid(scopeId));
  requireConfig(granted?.read, 403, 'Structure inaccessible');
  const { rows: scope } = await store.query<{ label: string }>('SELECT label FROM unoa.scope WHERE id = $1', [scopeId]);
  const { rows } = await store.query<{ id: string; code: string; title: string; versions: { id: string; number: number; language: string; state: string }[]; offerings: number }>(`
    SELECT course.id, course.code, course.title,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id', version.id, 'number', version.number, 'language', version.language,
        'state', version.state) ORDER BY version.number DESC) FROM unoa.course_version AS version WHERE version.course_id = course.id), '[]') AS versions,
      (SELECT count(*)::int FROM unoa.course_offering AS offering JOIN unoa.course_version AS version ON version.id = offering.course_version_id
        WHERE version.course_id = course.id) AS offerings
    FROM unoa.course WHERE course.owner_scope_id = $1 ORDER BY course.code LIMIT 500
  `, [scopeId]);
  return { scope: { id: scopeId, label: scope[0]?.label ?? '' }, rights: granted, courses: rows };
}

export async function courseDetails(settings: IamSettings, actor: string, courseId: string) {
  const store = database(settings);
  const { course, rights: granted } = await courseOwner(store, actor, uuid(courseId), 'read');
  const [versions, offerings] = await Promise.all([
    store.query<{ id: string; number: number; language: string; state: string; title: string; variant_of: string | null; published_at: Date | null }>(`
      SELECT id, number, language, state, title, variant_of, published_at FROM unoa.course_version WHERE course_id = $1 ORDER BY number DESC
    `, [course.id]),
    store.query<{ id: string; label: string; state: string; time_zone: string; starts_on: string; ends_on: string; number: number; members: number }>(`
      SELECT offering.id, offering.label, offering.state, offering.time_zone, offering.starts_on::text, offering.ends_on::text, version.number,
        (SELECT count(*)::int FROM unoa.offering_member WHERE offering_id = offering.id AND removed_at IS NULL) AS members
      FROM unoa.course_offering AS offering JOIN unoa.course_version AS version ON version.id = offering.course_version_id
      WHERE version.course_id = $1 ORDER BY offering.starts_on DESC
    `, [course.id]),
  ]);
  return { course, rights: granted, versions: versions.rows, offerings: offerings.rows };
}

function syllabus(input: Input) {
  return {
    title: boundedText(input.title, 200, 'Intitulé'),
    objectives: boundedText(input.objectives, 4000, 'Objectifs'),
    prerequisites: optional(input.prerequisites, text(2000, 'Prérequis')),
    methods: optional(input.methods, text(2000, 'Méthodes')),
    bibliography: optional(input.bibliography, text(4000, 'Bibliographie')),
    expectedHours: optional(input.expectedHours, value => {
      const hours = numeric(value);
      requireConfig(hours > 0 && hours < 100000, 400, 'Durée prévue invalide');
      return hours;
    }),
  };
}

async function nextNumber(store: Queryable, courseId: string) {
  const { rows } = await store.query<{ next: number }>('SELECT coalesce(max(number), 0) + 1 AS next FROM unoa.course_version WHERE course_id = $1', [courseId]);
  return rows[0].next;
}

async function insertCourseVersion(store: Queryable, courseId: string, tag: string, variantOf: string | null,
  variantNote: string | null, item: ReturnType<typeof syllabus>, actor: string) {
  const { rows } = await store.query<{ id: string }>(`
    INSERT INTO unoa.course_version(course_id, number, language, variant_of, variant_note, title, objectives,
      prerequisites, methods, bibliography, expected_hours, author_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id
  `, [courseId, await nextNumber(store, courseId), tag, variantOf, variantNote, item.title, item.objectives,
    item.prerequisites, item.methods, item.bibliography, item.expectedHours, actor]);
  return rows[0].id;
}

export async function createCourseVersion(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const courseId = uuid(id);
  const tag = language(input.language);
  const item = syllabus(input);
  return transaction(settings, 'unoa.lms.course.' + courseId, async store => {
    const { course } = await courseOwner(store, actor, courseId, 'write');
    const versionId = await insertCourseVersion(store, courseId, tag, null, null, item, actor);
    await audit(store, actor, course.owner_scope_id, 'lms.version_created', correlation, versionId);
    return { id: versionId };
  });
}

interface CourseVersionRow {
  id: string; course_id: string; number: number; language: string; state: string; title: string; objectives: string;
  prerequisites: string | null; methods: string | null; bibliography: string | null; expected_hours: string | null;
  author_id: string; reviewer_id: string | null; review_note: string | null; variant_of: string | null; variant_note: string | null;
  discipline_checked: boolean; pedagogy_checked: boolean; rights_checked: boolean; published_at: Date | null;
}

export interface LessonRow {
  id: string; module_id: string; ordinal: number; kind: string; title: string; body: string | null; media_url: string | null;
  captions_url: string | null; captions_language: string | null; transcript: string | null; chapters: { at: number; title: string }[];
  expected_minutes: number | null; requires_lesson_id: string | null; downloadable: boolean; rights: string;
}

export interface ModuleRow { id: string; ordinal: number; title: string; summary: string | null; access_mode: 'free' | 'sequential' }

async function versionContent(store: Queryable, versionId: string) {
  const [modules, lessons] = await Promise.all([
    store.query<ModuleRow>('SELECT id, ordinal, title, summary, access_mode FROM unoa.course_module WHERE version_id = $1 ORDER BY ordinal', [versionId]),
    store.query<LessonRow>(`
      SELECT lesson.id, lesson.module_id, lesson.ordinal, lesson.kind, lesson.title, lesson.body, lesson.media_url, lesson.captions_url,
             lesson.captions_language, lesson.transcript, lesson.chapters, lesson.expected_minutes, lesson.requires_lesson_id,
             lesson.downloadable, lesson.rights
      FROM unoa.lesson JOIN unoa.course_module AS module ON module.id = lesson.module_id
      WHERE lesson.version_id = $1 ORDER BY module.ordinal, lesson.ordinal
    `, [versionId]),
  ]);
  return { modules: modules.rows, lessons: lessons.rows };
}

export async function courseVersionDetails(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const { rows } = await store.query<CourseVersionRow>('SELECT * FROM unoa.course_version WHERE id = $1', [uuid(id)]);
  requireConfig(rows[0], 404, 'Version introuvable');
  const { course, rights: granted } = await courseOwner(store, actor, rows[0].course_id, 'read');
  return { version: rows[0], course, rights: granted, ...await versionContent(store, rows[0].id) };
}

async function lockCourseVersion(store: PoolClient, actor: string, versionId: string, right: Right) {
  const { rows } = await store.query<CourseVersionRow>('SELECT * FROM unoa.course_version WHERE id = $1 FOR UPDATE', [versionId]);
  requireConfig(rows[0], 404, 'Version introuvable');
  const { course } = await courseOwner(store, actor, rows[0].course_id, right);
  return { version: rows[0], course };
}

function lessonInput(input: Input, versionId: string) {
  const kind = choice(input.kind, lessonKinds, 'Nature de leçon');
  const chapters = optionalText(input.chapters) === null ? [] : parseChapters(String(input.chapters));
  requireConfig(chapters, 400, 'Chapitres invalides : une ligne « mm:ss Titre » par chapitre, dans l’ordre');
  const media = optional(input.mediaUrl, value => https(value, 'Média'));
  requireConfig(!['video', 'audio', 'document', 'link'].includes(kind) || media, 400, 'Adresse du média requise');
  const body = optional(input.body, text(60000, 'Contenu'));
  requireConfig(!['page', 'activity'].includes(kind) || body, 400, 'Contenu requis');
  return {
    kind, versionId, title: boundedText(input.title, 200, 'Titre'), body, media,
    captions: optional(input.captionsUrl, value => https(value, 'Sous-titres')),
    captionsLanguage: optional(input.captionsLanguage, language),
    transcript: optional(input.transcript, text(60000, 'Transcription')),
    chapters, minutes: optional(input.expectedMinutes, value => integer(value, 'Durée', 1, 6000)),
    requires: optional(input.requiresLessonId, uuid),
    downloadable: flag(input.downloadable),
    rights: boundedText(input.rights, 500, 'Droits et licence'),
  };
}

type CourseEditor = (store: PoolClient, version: CourseVersionRow, input: Input) => Promise<string>;

const courseEditors: Record<string, CourseEditor> = {
  async update(store, version, input) {
    const item = syllabus(input);
    await store.query(`
      UPDATE unoa.course_version SET title = $2, objectives = $3, prerequisites = $4, methods = $5, bibliography = $6,
        expected_hours = $7 WHERE id = $1
    `, [version.id, item.title, item.objectives, item.prerequisites, item.methods, item.bibliography, item.expectedHours]);
    return version.id;
  },
  async modules(store, version, input) {
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.course_module(version_id, ordinal, title, summary, access_mode) VALUES ($1, $2, $3, $4, $5) RETURNING id
    `, [version.id, integer(input.ordinal, 'Rang', 1, 1000), boundedText(input.title, 200, 'Titre'),
      optional(input.summary, text(2000, 'Résumé')), choice(input.accessMode ?? 'free', ['free', 'sequential'] as const, 'Accès')]);
    return rows[0].id;
  },
  async lessons(store, version, input) {
    const item = lessonInput(input, version.id);
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.lesson(version_id, module_id, ordinal, kind, title, body, media_url, captions_url, captions_language,
        transcript, chapters, expected_minutes, requires_lesson_id, downloadable, rights)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id
    `, [version.id, uuid(input.moduleId), integer(input.ordinal, 'Rang', 1, 1000), item.kind, item.title, item.body, item.media,
      item.captions, item.captionsLanguage, item.transcript, JSON.stringify(item.chapters), item.minutes, item.requires,
      item.downloadable, item.rights]);
    return rows[0].id;
  },
};

export async function editCourseVersion(settings: IamSettings, actor: string, id: string, part: string, input: Input, correlation: string) {
  const versionId = uuid(id);
  const editor = courseEditors[part];
  requireConfig(editor, 404, 'Opération inconnue');
  return transaction(settings, 'unoa.lms.version.' + versionId, async store => {
    const { version, course } = await lockCourseVersion(store, actor, versionId, 'write');
    requireConfig(version.state === 'draft', 409, 'Seul un brouillon est modifiable');
    const target = await editor(store, version, input);
    await audit(store, actor, course.owner_scope_id, 'lms.version_edited', correlation, target);
    return { id: versionId };
  });
}

export async function removeFromCourseVersion(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const versionId = uuid(id);
  const itemId = uuid(input.itemId);
  const kind = choice(input.kind, ['module', 'lesson'] as const, 'Élément');
  return transaction(settings, 'unoa.lms.version.' + versionId, async store => {
    const { version, course } = await lockCourseVersion(store, actor, versionId, 'write');
    requireConfig(version.state === 'draft', 409, 'Seul un brouillon est modifiable');
    const removed = kind === 'lesson'
      ? await store.query('DELETE FROM unoa.lesson WHERE id = $1 AND version_id = $2', [itemId, versionId])
      : await store.query('DELETE FROM unoa.course_module WHERE id = $1 AND version_id = $2', [itemId, versionId]);
    requireConfig(removed.rowCount === 1, 404, 'Élément introuvable ou encore utilisé');
    await audit(store, actor, course.owner_scope_id, 'lms.version_edited', correlation, itemId);
    return { id: versionId };
  });
}

async function copyContent(store: PoolClient, from: string, to: string, modules?: ModuleRow[], lessons?: LessonRow[]) {
  const content = modules && lessons ? { modules, lessons } : await versionContent(store, from);
  const ids = new Map<string, string>();
  const fresh = (old: string) => { if (!ids.has(old)) ids.set(old, randomUUID()); return ids.get(old)!; };
  for (const module of content.modules) {
    await store.query('INSERT INTO unoa.course_module(id, version_id, ordinal, title, summary, access_mode) VALUES ($1, $2, $3, $4, $5, $6)',
      [fresh(module.id), to, module.ordinal, module.title, module.summary, module.access_mode]);
  }
  // Lessons are inserted after the lesson they depend on so the foreign key holds.
  const ordered: LessonRow[] = [];
  const pending = [...content.lessons];
  while (pending.length) {
    const index = pending.findIndex(lesson => !lesson.requires_lesson_id || ordered.some(done => done.id === lesson.requires_lesson_id));
    requireConfig(index >= 0, 400, 'Dépendances de leçons incohérentes');
    ordered.push(...pending.splice(index, 1));
  }
  for (const lesson of ordered) {
    await store.query(`
      INSERT INTO unoa.lesson(id, version_id, module_id, ordinal, kind, title, body, media_url, captions_url, captions_language,
        transcript, chapters, expected_minutes, requires_lesson_id, downloadable, rights)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `, [fresh(lesson.id), to, fresh(lesson.module_id), lesson.ordinal, lesson.kind, lesson.title, lesson.body, lesson.media_url,
      lesson.captions_url, lesson.captions_language, lesson.transcript, JSON.stringify(lesson.chapters ?? []), lesson.expected_minutes,
      lesson.requires_lesson_id ? fresh(lesson.requires_lesson_id) : null, lesson.downloadable, lesson.rights]);
  }
}

export async function transitionCourseVersion(settings: IamSettings, actor: string, id: string, action: string, input: Input, correlation: string) {
  const versionId = uuid(id);
  return transaction(settings, 'unoa.lms.version.' + versionId, async store => {
    if (action === 'submit') {
      const { version, course } = await lockCourseVersion(store, actor, versionId, 'write');
      requireConfig(version.state === 'draft', 409, 'Seul un brouillon est soumis');
      const { modules, lessons } = await versionContent(store, versionId);
      requireConfig(modules.length > 0 && modules.every(module => lessons.some(lesson => lesson.module_id === module.id)),
        422, 'Chaque module doit contenir au moins une leçon');
      await store.query("UPDATE unoa.course_version SET state = 'review', submitted_at = now(), review_note = NULL WHERE id = $1", [versionId]);
      await audit(store, actor, course.owner_scope_id, 'lms.version_submitted', correlation, versionId);
      return { id: versionId };
    }
    if (action === 'review') {
      const { version, course } = await lockCourseVersion(store, actor, versionId, 'review');
      requireConfig(version.state === 'review', 409, 'Cette version n’est pas en revue');
      requireConfig(version.author_id !== actor, 403, 'La revue revient à une autre personne que l’auteur');
      const decision = choice(input.decision, ['approve', 'reject'] as const, 'Décision');
      const note = optional(input.note, text(1000, 'Observation'));
      if (decision === 'reject') {
        requireConfig(note, 400, 'Motiver le renvoi');
        await store.query("UPDATE unoa.course_version SET state = 'draft', reviewer_id = $2, review_note = $3 WHERE id = $1", [versionId, actor, note]);
      } else {
        requireConfig(flag(input.discipline) && flag(input.pedagogy) && flag(input.rights), 422,
          'Les contrôles disciplinaire, pédagogique et de droits sont tous requis');
        await store.query("UPDATE unoa.course_version SET state = 'retired' WHERE course_id = $1 AND language = $2 AND state = 'published'",
          [version.course_id, version.language]);
        await store.query(`
          UPDATE unoa.course_version SET state = 'published', reviewer_id = $2, review_note = $3, discipline_checked = true,
            pedagogy_checked = true, rights_checked = true, published_at = now() WHERE id = $1
        `, [versionId, actor, note]);
      }
      await audit(store, actor, course.owner_scope_id, decision === 'approve' ? 'lms.version_published' : 'lms.version_reviewed', correlation, versionId);
      return { id: versionId };
    }
    if (action === 'derive') {
      const { version, course } = await lockCourseVersion(store, actor, versionId, 'write');
      requireConfig(version.state === 'published' || version.state === 'retired', 409, 'Une version dérivée part d’une version publiée');
      const tag = optionalText(input.language) === null ? version.language : language(input.language);
      const variant = tag !== version.language;
      const created = await insertCourseVersion(store, version.course_id, tag, variant ? version.id : null,
        variant ? optional(input.variantNote, text(500, 'Note de variante')) ?? 'Variante linguistique ou régionale' : null, {
          title: version.title, objectives: version.objectives, prerequisites: version.prerequisites, methods: version.methods,
          bibliography: version.bibliography, expectedHours: version.expected_hours === null ? null : Number(version.expected_hours),
        }, actor);
      await copyContent(store, versionId, created);
      await audit(store, actor, course.owner_scope_id, 'lms.version_created', correlation, created);
      return { id: created };
    }
    throw new ConfigProblem(404, 'Opération inconnue');
  });
}

// Export keeps the pedagogical content and its rights notices, never learners' data.
export async function exportCourseVersion(settings: IamSettings, actor: string, id: string) {
  const details = await courseVersionDetails(settings, actor, id);
  const { version, modules, lessons } = details;
  return {
    format: 'unoa.course-version', formatVersion: 1, exportedAt: new Date().toISOString(),
    course: { code: details.course.code, title: details.course.title },
    version: {
      language: version.language, title: version.title, objectives: version.objectives, prerequisites: version.prerequisites,
      methods: version.methods, bibliography: version.bibliography, expectedHours: version.expected_hours === null ? null : Number(version.expected_hours),
    },
    modules: modules.map(module => ({ ...module, lessons: lessons.filter(lesson => lesson.module_id === module.id) })),
  };
}

export async function importCourseVersion(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const courseId = uuid(id);
  requireConfig(input.format === 'unoa.course-version' && input.formatVersion === 1, 400, 'Format d’export non reconnu');
  const source = input.version as Input;
  requireConfig(source && typeof source === 'object' && Array.isArray(input.modules) && input.modules.length <= 500, 400, 'Contenu corrompu');
  const tag = language(source.language);
  const item = syllabus(source);
  const modules: ModuleRow[] = [];
  const lessons: LessonRow[] = [];
  for (const raw of input.modules as Input[]) {
    requireConfig(raw && typeof raw === 'object' && typeof raw.id === 'string' && Array.isArray(raw.lessons), 400, 'Contenu corrompu');
    const module = {
      id: uuid(raw.id), ordinal: integer(raw.ordinal, 'Rang', 1, 1000), title: boundedText(raw.title, 200, 'Titre'),
      summary: optional(raw.summary, text(2000, 'Résumé')), access_mode: choice(raw.access_mode, ['free', 'sequential'] as const, 'Accès'),
    };
    modules.push(module);
    for (const lesson of raw.lessons as Input[]) {
      const parsed = lessonInput({
        ...lesson, mediaUrl: lesson.media_url, captionsUrl: lesson.captions_url, captionsLanguage: lesson.captions_language,
        expectedMinutes: lesson.expected_minutes, requiresLessonId: lesson.requires_lesson_id,
        chapters: Array.isArray(lesson.chapters) ? '' : lesson.chapters,
      }, '');
      const chapters = Array.isArray(lesson.chapters) ? lesson.chapters : [];
      requireConfig(chapters.length <= 200 && chapters.every(entry => entry && Number.isInteger(entry.at) && typeof entry.title === 'string'),
        400, 'Chapitres corrompus');
      lessons.push({
        id: uuid(lesson.id), module_id: module.id, ordinal: integer(lesson.ordinal, 'Rang', 1, 1000), kind: parsed.kind,
        title: parsed.title, body: parsed.body, media_url: parsed.media, captions_url: parsed.captions,
        captions_language: parsed.captionsLanguage, transcript: parsed.transcript, chapters, expected_minutes: parsed.minutes,
        requires_lesson_id: parsed.requires, downloadable: parsed.downloadable, rights: parsed.rights,
      });
    }
  }
  return transaction(settings, 'unoa.lms.course.' + courseId, async store => {
    const { course } = await courseOwner(store, actor, courseId, 'write');
    const created = await insertCourseVersion(store, courseId, tag, null, null, item, actor);
    await copyContent(store, '', created, modules, lessons);
    await audit(store, actor, course.owner_scope_id, 'lms.version_imported', correlation, created);
    return { id: created };
  });
}

// ---------------------------------------------------------------- offerings

export async function createOffering(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const versionId = uuid(id);
  const label = boundedText(input.label, 200, 'Promotion ou groupe');
  const timeZone = String(input.timeZone ?? '');
  requireConfig(timeZones.has(timeZone), 400, 'Fuseau horaire IANA inconnu');
  const startsOn = day(input.startsOn, 'Début');
  const endsOn = day(input.endsOn, 'Fin');
  requireConfig(endsOn >= startsOn, 400, 'Période incohérente');
  return transaction(settings, 'unoa.lms.version.' + versionId, async store => {
    const { version, course } = await lockCourseVersion(store, actor, versionId, 'manage');
    requireConfig(version.state === 'published', 422, 'Une offre porte sur une version publiée');
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.course_offering(course_version_id, owner_scope_id, label, time_zone, starts_on, ends_on, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
    `, [versionId, course.owner_scope_id, label, timeZone, startsOn, endsOn, actor]);
    await audit(store, actor, course.owner_scope_id, 'lms.offering_created', correlation, rows[0].id);
    return { id: rows[0].id };
  });
}

export interface OfferingRow {
  id: string; label: string; state: string; time_zone: string; starts_on: string; ends_on: string;
  course_version_id: string; owner_scope_id: string; course_id: string; course_code: string; title: string; language: string;
  role: 'learner' | 'teacher' | 'tutor' | null; manage: boolean;
}

async function offering(store: Queryable, actor: string, offeringId: string) {
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
  requireConfig(found && (found.role || found.manage), 403, 'Vous n’êtes pas membre de cette offre');
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
    requireConfig(item.manage, 403, 'Gestion des membres non autorisée');
    if (remove) {
      const removed = await store.query(`
        UPDATE unoa.offering_member SET removed_at = now(), removed_by = $4
        WHERE offering_id = $1 AND account_id = $2 AND role = $3 AND removed_at IS NULL
      `, [offeringId, accountId, role, actor]);
      requireConfig(removed.rowCount === 1, 404, 'Membre introuvable');
    } else {
      requireConfig(item.state === 'open', 409, 'Offre close');
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
    requireConfig(item.manage, 403, 'Clôture non autorisée');
    requireConfig(item.state === 'open', 409, 'Offre déjà close');
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
  requireConfig(lesson, 404, 'Leçon introuvable');
  requireConfig(view.access[lesson.id]?.open, 423, 'Leçon verrouillée');
  const { rows } = await database(settings).query<{ body: string | null; bookmarked: boolean }>(
    'SELECT body, bookmarked FROM unoa.learner_note WHERE offering_id = $1 AND lesson_id = $2 AND account_id = $3',
    [view.offering.id, lesson.id, actor],
  );
  return { ...view, lesson, note: rows[0] ?? null };
}

async function lessonInOffering(store: Queryable, item: OfferingRow, lessonId: string) {
  const { rows } = await store.query('SELECT 1 FROM unoa.lesson WHERE id = $1 AND version_id = $2', [lessonId, item.course_version_id]);
  requireConfig(rows[0], 404, 'Leçon introuvable dans cette offre');
}

export async function completeLesson(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const offeringId = uuid(id);
  const lessonId = uuid(input.lessonId);
  const view = await offeringView(settings, actor, offeringId);
  requireConfig(view.offering.role === 'learner', 403, 'La progression concerne les apprenants');
  requireConfig(view.access[lessonId]?.open, 423, 'Leçon verrouillée');
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
    requireConfig(item.role, 403, 'Notes réservées aux membres');
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
    requireConfig(canTeach(item), 403, 'Échéances réservées à l’équipe pédagogique');
    // The due date is typed in the offering's own time zone.
    const dueAt = zonedToUtc(String(input.dueAt ?? ''), item.time_zone);
    requireConfig(dueAt, 400, 'Échéance invalide');
    await lessonInOffering(store, item, lessonId);
    await store.query(`
      INSERT INTO unoa.lesson_due(offering_id, lesson_id, due_at, set_by) VALUES ($1, $2, $3, $4)
      ON CONFLICT (offering_id, lesson_id) DO UPDATE SET due_at = excluded.due_at, set_by = excluded.set_by
    `, [offeringId, lessonId, dueAt, actor]);
    await audit(store, actor, item.owner_scope_id, 'lms.due_set', correlation, lessonId);
    return { id: offeringId };
  });
}

// ------------------------------------------------------------------- forum

export async function forumThread(settings: IamSettings, actor: string, id: string, threadId: string) {
  const store = database(settings);
  const item = await offering(store, actor, uuid(id));
  const { rows: thread } = await store.query<{ id: string; title: string; locked_at: Date | null }>(
    'SELECT id, title, locked_at FROM unoa.forum_thread WHERE id = $1 AND offering_id = $2', [uuid(threadId), item.id],
  );
  requireConfig(thread[0], 404, 'Discussion introuvable');
  const moderator = canModerate(item);
  const { rows: posts } = await store.query<{ id: string; author: string | null; body: string | null; created_at: Date; hidden: boolean; hidden_reason: string | null; mine: boolean }>(`
    SELECT post.id, member.display_name AS author, CASE WHEN post.hidden_at IS NULL OR $3 THEN post.body END AS body,
           post.created_at, post.hidden_at IS NOT NULL AS hidden, post.hidden_reason, post.author_id = $4 AS mine
    FROM unoa.forum_post AS post
    LEFT JOIN LATERAL (SELECT display_name FROM unoa.offering_member WHERE offering_id = $2 AND account_id = post.author_id
      AND display_name IS NOT NULL LIMIT 1) AS member ON true
    WHERE post.thread_id = $1 ORDER BY post.created_at LIMIT 500
  `, [thread[0].id, item.id, moderator, actor]);
  return { offering: item, thread: thread[0], posts, moderator };
}

export async function forumAction(settings: IamSettings, actor: string, id: string, action: string, input: Input, correlation: string) {
  const offeringId = uuid(id);
  return transaction(settings, 'unoa.lms.forum.' + offeringId, async store => {
    const item = await offering(store, actor, offeringId);
    requireConfig(item.role || item.manage, 403, 'Forum réservé aux membres');
    if (action === 'threads') {
      requireConfig(item.state === 'open', 409, 'Offre close');
      const title = boundedText(input.title, 200, 'Sujet');
      const body = boundedText(input.body, 10000, 'Message');
      const { rows } = await store.query<{ id: string }>('INSERT INTO unoa.forum_thread(offering_id, title, created_by) VALUES ($1, $2, $3) RETURNING id',
        [offeringId, title, actor]);
      await store.query('INSERT INTO unoa.forum_post(thread_id, author_id, body) VALUES ($1, $2, $3)', [rows[0].id, actor, body]);
      return { id: rows[0].id };
    }
    const threadId = uuid(input.threadId);
    const { rows } = await store.query('SELECT 1 FROM unoa.forum_thread WHERE id = $1 AND offering_id = $2', [threadId, offeringId]);
    requireConfig(rows[0], 404, 'Discussion introuvable');
    if (action === 'posts') {
      const { rows: post } = await store.query<{ id: string }>('INSERT INTO unoa.forum_post(thread_id, author_id, body) VALUES ($1, $2, $3) RETURNING id',
        [threadId, actor, boundedText(input.body, 10000, 'Message')]);
      return { id: post[0].id };
    }
    requireConfig(canModerate(item), 403, 'Modération réservée à l’équipe pédagogique');
    if (action === 'hide') {
      const hidden = await store.query(`
        UPDATE unoa.forum_post SET hidden_at = now(), hidden_by = $3, hidden_reason = $4 WHERE id = $1 AND thread_id = $2 AND hidden_at IS NULL
      `, [uuid(input.postId), threadId, actor, boundedText(input.reason, 500, 'Motif')]);
      requireConfig(hidden.rowCount === 1, 404, 'Message introuvable ou déjà masqué');
      await audit(store, actor, item.owner_scope_id, 'lms.post_hidden', correlation, String(input.postId));
      return { id: threadId };
    }
    if (action === 'lock') {
      await store.query('UPDATE unoa.forum_thread SET locked_at = now() WHERE id = $1 AND locked_at IS NULL', [threadId]);
      await audit(store, actor, item.owner_scope_id, 'lms.thread_locked', correlation, threadId);
      return { id: threadId };
    }
    throw new ConfigProblem(404, 'Opération inconnue');
  });
}

// ----------------------------------------------------------- notifications

export async function notify(store: Queryable, offeringId: string, except: string, kind: string, title: string, body: string | null, link: string) {
  await store.query(`
    INSERT INTO unoa.notification(account_id, kind, title, body, link)
    SELECT DISTINCT account_id, $3, $4, $5, $6 FROM unoa.offering_member
    WHERE offering_id = $1 AND removed_at IS NULL AND account_id <> $2
  `, [offeringId, except, kind, title, body, link]);
}

export async function notifications(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; kind: string; title: string; body: string | null; link: string | null; created_at: Date; read_at: Date | null }>(
    'SELECT id, kind, title, body, link, created_at, read_at FROM unoa.notification WHERE account_id = $1 ORDER BY created_at DESC LIMIT 50', [actor],
  );
  return rows;
}

export async function markRead(settings: IamSettings, actor: string, id: string) {
  await database(settings).query('UPDATE unoa.notification SET read_at = now() WHERE id = $1 AND account_id = $2 AND read_at IS NULL', [uuid(id), actor]);
  return { id };
}
