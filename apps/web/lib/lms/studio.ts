import 'server-only';
// Course studio: pedagogical versions of a catalogue course (syllabus, modules,
// lessons), review with three attestations, immutable publication, derived
// editions or language variants, export and restoration.
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { parseChapters } from '@unoa/domain/learning';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, choice, day, ensure, flag, https, integer, language, numeric, optional, optionalText, Problem, text, timeZone, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';

export const lessonKinds = ['page', 'video', 'audio', 'document', 'link', 'activity'] as const;
export type Right = 'read' | 'write' | 'review' | 'manage';

export async function lmsContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string; nature: string }>(`
    SELECT scope.id, scope.label, kind.nature FROM unoa.scope
    JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE kind.nature IN ('institution', 'academic_unit') AND unoa.has_scope_permission($1, 'lms.read', scope.id)
    ORDER BY kind.nature DESC, scope.label LIMIT 200
  `, [actor]);
  return rows;
}

export async function rights(store: Queryable, actor: string, scope: string) {
  const { rows } = await store.query<Record<Right, boolean>>(`
    SELECT unoa.has_scope_permission($1, 'lms.read', $2) AS read, unoa.has_scope_permission($1, 'lms.write', $2) AS write,
           unoa.has_scope_permission($1, 'lms.review', $2) AS review, unoa.has_scope_permission($1, 'lms.manage', $2) AS manage
  `, [actor, scope]);
  return rows[0];
}

export async function courseOwner(store: Queryable, actor: string, courseId: string, right: Right) {
  const { rows } = await store.query<{ id: string; code: string; title: string; owner_scope_id: string; owner_label: string }>(`
    SELECT course.id, course.code, course.title, course.owner_scope_id, owner.label AS owner_label
    FROM unoa.course JOIN unoa.scope AS owner ON owner.id = course.owner_scope_id WHERE course.id = $1
  `, [courseId]);
  ensure(rows[0], 404, 'Cours introuvable');
  const granted = await rights(store, actor, rows[0].owner_scope_id);
  ensure(granted[right], 403, 'Action non autorisée sur ce cours');
  return { course: rows[0], rights: granted };
}

export async function lmsOverview(settings: IamSettings, actor: string, scopeId: string) {
  const store = database(settings);
  const granted = await rights(store, actor, uuid(scopeId));
  ensure(granted?.read, 403, 'Structure inaccessible');
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
      ensure(hours > 0 && hours < 100000, 400, 'Durée prévue invalide');
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

export interface CourseVersionRow {
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

export async function versionContent(store: Queryable, versionId: string) {
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
  ensure(rows[0], 404, 'Version introuvable');
  const { course, rights: granted } = await courseOwner(store, actor, rows[0].course_id, 'read');
  return { version: rows[0], course, rights: granted, ...await versionContent(store, rows[0].id) };
}

export async function lockCourseVersion(store: PoolClient, actor: string, versionId: string, right: Right) {
  const { rows } = await store.query<CourseVersionRow>('SELECT * FROM unoa.course_version WHERE id = $1 FOR UPDATE', [versionId]);
  ensure(rows[0], 404, 'Version introuvable');
  const { course } = await courseOwner(store, actor, rows[0].course_id, right);
  return { version: rows[0], course };
}

function lessonInput(input: Input, versionId: string) {
  const kind = choice(input.kind, lessonKinds, 'Nature de leçon');
  const chapters = optionalText(input.chapters) === null ? [] : parseChapters(String(input.chapters));
  ensure(chapters, 400, 'Chapitres invalides : une ligne « mm:ss Titre » par chapitre, dans l’ordre');
  const media = optional(input.mediaUrl, value => https(value, 'Média'));
  ensure(!['video', 'audio', 'document', 'link'].includes(kind) || media, 400, 'Adresse du média requise');
  const body = optional(input.body, text(60000, 'Contenu'));
  ensure(!['page', 'activity'].includes(kind) || body, 400, 'Contenu requis');
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
  ensure(editor, 404, 'Opération inconnue');
  return transaction(settings, 'unoa.lms.version.' + versionId, async store => {
    const { version, course } = await lockCourseVersion(store, actor, versionId, 'write');
    ensure(version.state === 'draft', 409, 'Seul un brouillon est modifiable');
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
    ensure(version.state === 'draft', 409, 'Seul un brouillon est modifiable');
    const removed = kind === 'lesson'
      ? await store.query('DELETE FROM unoa.lesson WHERE id = $1 AND version_id = $2', [itemId, versionId])
      : await store.query('DELETE FROM unoa.course_module WHERE id = $1 AND version_id = $2', [itemId, versionId]);
    ensure(removed.rowCount === 1, 404, 'Élément introuvable ou encore utilisé');
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
    ensure(index >= 0, 400, 'Dépendances de leçons incohérentes');
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
      ensure(version.state === 'draft', 409, 'Seul un brouillon est soumis');
      const { modules, lessons } = await versionContent(store, versionId);
      ensure(modules.length > 0 && modules.every(module => lessons.some(lesson => lesson.module_id === module.id)),
        422, 'Chaque module doit contenir au moins une leçon');
      await store.query("UPDATE unoa.course_version SET state = 'review', submitted_at = now(), review_note = NULL WHERE id = $1", [versionId]);
      await audit(store, actor, course.owner_scope_id, 'lms.version_submitted', correlation, versionId);
      return { id: versionId };
    }
    if (action === 'review') {
      const { version, course } = await lockCourseVersion(store, actor, versionId, 'review');
      ensure(version.state === 'review', 409, 'Cette version n’est pas en revue');
      ensure(version.author_id !== actor, 403, 'La revue revient à une autre personne que l’auteur');
      const decision = choice(input.decision, ['approve', 'reject'] as const, 'Décision');
      const note = optional(input.note, text(1000, 'Observation'));
      if (decision === 'reject') {
        ensure(note, 400, 'Motiver le renvoi');
        await store.query("UPDATE unoa.course_version SET state = 'draft', reviewer_id = $2, review_note = $3 WHERE id = $1", [versionId, actor, note]);
      } else {
        ensure(flag(input.discipline) && flag(input.pedagogy) && flag(input.rights), 422,
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
      ensure(version.state === 'published' || version.state === 'retired', 409, 'Une version dérivée part d’une version publiée');
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
    throw new Problem(404, 'Opération inconnue');
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
  ensure(input.format === 'unoa.course-version' && input.formatVersion === 1, 400, 'Format d’export non reconnu');
  const source = input.version as Input;
  ensure(source && typeof source === 'object' && Array.isArray(input.modules) && input.modules.length <= 500, 400, 'Contenu corrompu');
  const tag = language(source.language);
  const item = syllabus(source);
  const modules: ModuleRow[] = [];
  const lessons: LessonRow[] = [];
  for (const raw of input.modules as Input[]) {
    ensure(raw && typeof raw === 'object' && typeof raw.id === 'string' && Array.isArray(raw.lessons), 400, 'Contenu corrompu');
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
      ensure(chapters.length <= 200 && chapters.every(entry => entry && Number.isInteger(entry.at) && typeof entry.title === 'string'),
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

