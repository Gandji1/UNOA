import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { checkCurriculum, simulatePlan, type CurriculumModel } from '@unoa/domain/curriculum';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, ConfigProblem, numeric, requireConfig, utcTime, uuid, type Input } from '@/lib/config/validation';
import { language, typeCode } from '@/lib/territory/validation';
import { code, flag } from '@/lib/org/store';
import { audit, optionalText, transaction, type Queryable } from '@/lib/studio/db';

export const authorizationStatuses = ['preparation', 'non_degree', 'conditional', 'authorized', 'suspended', 'expired'] as const;
export const requirementKinds = ['internship', 'thesis', 'defense', 'project', 'other'] as const;

const optional = <T>(input: unknown, read: (value: unknown) => T) => optionalText(input) === null ? null : read(input);
const text = (limit: number, label: string) => (value: unknown) => boundedText(value, limit, label);

function amount(input: unknown, label: string, positive = false) {
  const value = numeric(input);
  requireConfig(value >= 0 && (!positive || value > 0) && value < 1_000_000 && Math.round(value * 100) === value * 100,
    400, label + ' invalide');
  return value;
}

function integer(input: unknown, label: string, minimum: number, maximum: number) {
  const value = numeric(input);
  requireConfig(Number.isInteger(value) && value >= minimum && value <= maximum, 400, label + ' invalide');
  return value;
}

function list(input: unknown) {
  if (input === undefined || input === null || input === '') return [];
  const values = typeof input === 'string' ? input.split(/[\s,]+/).filter(Boolean) : input;
  requireConfig(Array.isArray(values) && values.length <= 16, 400, 'Liste invalide');
  return values;
}

function choice<T extends string>(input: unknown, values: readonly T[], label: string): T {
  requireConfig(values.includes(input as T), 400, label + ' invalide');
  return input as T;
}

// ---------------------------------------------------------------- contexts

export interface CatalogScope {
  id: string;
  label: string;
  nature: 'institution' | 'academic_unit';
  type_label: string;
  root_id: string;
  write: boolean;
  review: boolean;
  publish: boolean;
  authorize: boolean;
  define: boolean;
}

const contextFields = `
  scope.id, scope.label, kind.nature, kind.label AS type_label,
  (SELECT id FROM unoa.scope WHERE parent_id IS NULL) AS root_id,
  unoa.has_scope_permission($1, 'catalog.write', scope.id) AS write,
  unoa.has_scope_permission($1, 'catalog.review', scope.id) AS review,
  unoa.has_scope_permission($1, 'catalog.publish', scope.id) AS publish,
  unoa.has_scope_permission($1, 'catalog.authorize', scope.id) AS authorize,
  unoa.has_scope_permission($1, 'catalog.define', (SELECT id FROM unoa.scope WHERE parent_id IS NULL)) AS define
  FROM unoa.scope AS scope
  JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
  LEFT JOIN unoa.org_unit AS unit ON unit.scope_id = scope.id
`;

export async function catalogContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<CatalogScope>(`
    SELECT ${contextFields}
    WHERE (kind.nature = 'institution' OR (kind.nature = 'academic_unit' AND unit.status = 'active'))
      AND unoa.has_scope_permission($1, 'catalog.read', scope.id)
    ORDER BY kind.nature DESC, scope.label LIMIT 200
  `, [actor]);
  return rows;
}

async function context(store: Queryable, actor: string, scopeId: string) {
  const { rows } = await store.query<CatalogScope>(`
    SELECT ${contextFields}
    WHERE scope.id = $2 AND kind.nature IN ('institution', 'academic_unit')
      AND unoa.has_scope_permission($1, 'catalog.read', scope.id)
  `, [actor, scopeId]);
  return rows[0] ?? null;
}

async function requireContext(store: Queryable, actor: string, scopeId: string, right: 'write' | 'review' | 'publish' | 'authorize') {
  const scope = await context(store, actor, scopeId);
  requireConfig(scope?.[right], 403, 'Action non autorisée dans cette structure');
  return scope;
}

export async function catalogOverview(settings: IamSettings, actor: string, scopeId: string) {
  const store = database(settings);
  const scope = await context(store, actor, uuid(scopeId));
  requireConfig(scope, 403, 'Structure inaccessible');
  const [fieldTypes, kinds, fields, programs, courses, competencies] = await Promise.all([
    store.query<{ code: string; label: string; root_allowed: boolean; parents: string[] }>(`
      SELECT type.code, type.label, type.root_allowed,
        coalesce(array_agg(rule.parent_type_code ORDER BY rule.parent_type_code)
          FILTER (WHERE rule.parent_type_code IS NOT NULL), '{}') AS parents
      FROM unoa.field_type AS type LEFT JOIN unoa.field_type_parent AS rule ON rule.type_code = type.code
      GROUP BY type.code ORDER BY type.label
    `),
    store.query<{ code: string; label: string; degree_awarding: boolean; description: string | null }>(
      'SELECT code, label, degree_awarding, description FROM unoa.program_kind ORDER BY label',
    ),
    store.query<{ id: string; code: string; label: string; type_label: string; parent_id: string | null; status: string; owner_label: string }>(`
      SELECT field.id, field.code, field.label, type.label AS type_label, field.parent_id, field.status, owner.label AS owner_label
      FROM unoa.academic_field AS field
      JOIN unoa.field_type AS type ON type.code = field.type_code
      JOIN unoa.scope AS owner ON owner.id = field.owner_scope_id
      WHERE field.institution_id = unoa.nearest_institution($1)
      ORDER BY field.code LIMIT 500
    `, [scope.id]),
    store.query<{ id: string; code: string; title: string; kind_label: string; field_label: string | null; current_state: string | null; current_number: number | null; regulatory_status: string }>(`
      SELECT program.id, program.code, program.title, kind.label AS kind_label, field.label AS field_label,
        (SELECT state FROM unoa.program_version WHERE program_id = program.id ORDER BY number DESC LIMIT 1) AS current_state,
        (SELECT number FROM unoa.program_version WHERE program_id = program.id ORDER BY number DESC LIMIT 1) AS current_number,
        unoa.program_regulatory_status(program.id) AS regulatory_status
      FROM unoa.program
      JOIN unoa.program_kind AS kind ON kind.code = program.kind_code
      LEFT JOIN unoa.academic_field AS field ON field.id = program.field_id
      WHERE program.owner_scope_id = $1
      ORDER BY program.code LIMIT 500
    `, [scope.id]),
    store.query<{ id: string; code: string; title: string; description: string | null; programs: number }>(`
      SELECT course.id, course.code, course.title, course.description,
        (SELECT count(DISTINCT version.program_id)::int FROM unoa.unit_course AS link
          JOIN unoa.program_version AS version ON version.id = link.version_id WHERE link.course_id = course.id) AS programs
      FROM unoa.course WHERE course.owner_scope_id = $1 ORDER BY course.code LIMIT 500
    `, [scope.id]),
    store.query<{ id: string; code: string; label: string; description: string | null }>(
      'SELECT id, code, label, description FROM unoa.competency WHERE owner_scope_id = $1 ORDER BY code LIMIT 500',
      [scope.id],
    ),
  ]);
  return {
    scope, fieldTypes: fieldTypes.rows, kinds: kinds.rows, fields: fields.rows,
    programs: programs.rows, courses: courses.rows, competencies: competencies.rows,
  };
}

// --------------------------------------------------------------- definitions

async function requireDefine(store: Queryable, actor: string) {
  const { rows } = await store.query<{ root: string; allowed: boolean }>(`
    SELECT id AS root, unoa.has_scope_permission($1, 'catalog.define', id) AS allowed
    FROM unoa.scope WHERE parent_id IS NULL
  `, [actor]);
  requireConfig(rows[0]?.allowed, 403, 'Définition réservée à la racine de la plateforme');
  return rows[0].root;
}

export async function defineFieldType(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const item = {
    code: typeCode(input.code),
    label: boundedText(input.label, 120, 'Libellé'),
    rootAllowed: flag(input.rootAllowed),
    parents: list(input.parentTypes).map(value => typeCode(value)),
  };
  requireConfig(item.rootAllowed || item.parents.length > 0, 400, 'Indiquer un type parent ou autoriser la racine');
  return transaction(settings, 'unoa.catalog.types', async store => {
    const root = await requireDefine(store, actor);
    const created = await store.query(
      'INSERT INTO unoa.field_type(code, label, root_allowed) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING',
      [item.code, item.label, item.rootAllowed],
    );
    requireConfig(created.rowCount === 1, 409, 'Ce type existe déjà');
    for (const parent of item.parents) {
      await store.query('INSERT INTO unoa.field_type_parent(type_code, parent_type_code) VALUES ($1, $2)', [item.code, parent]);
    }
    await audit(store, actor, root, 'catalog.field_type_defined', correlation);
    return { code: item.code };
  });
}

export async function defineProgramKind(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const item = {
    code: typeCode(input.code),
    label: boundedText(input.label, 120, 'Libellé'),
    degree: flag(input.degreeAwarding),
    description: optional(input.description, text(1000, 'Description')),
  };
  return transaction(settings, 'unoa.catalog.kinds', async store => {
    const root = await requireDefine(store, actor);
    const created = await store.query(`
      INSERT INTO unoa.program_kind(code, label, degree_awarding, description) VALUES ($1, $2, $3, $4)
      ON CONFLICT (code) DO NOTHING
    `, [item.code, item.label, item.degree, item.description]);
    requireConfig(created.rowCount === 1, 409, 'Cette nature de programme existe déjà');
    await audit(store, actor, root, 'catalog.kind_defined', correlation);
    return { code: item.code };
  });
}

export async function createField(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const scopeId = uuid(input.scopeId);
  const item = {
    type: typeCode(input.typeCode),
    parent: optional(input.parentId, uuid),
    code: code(input.code),
    label: boundedText(input.label, 200, 'Libellé'),
    description: optional(input.description, text(2000, 'Description')),
  };
  return transaction(settings, 'unoa.catalog.' + scopeId, async store => {
    await requireContext(store, actor, scopeId, 'write');
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.academic_field(owner_scope_id, type_code, parent_id, code, label, description, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
    `, [scopeId, item.type, item.parent, item.code, item.label, item.description, actor]);
    await audit(store, actor, scopeId, 'catalog.field_created', correlation, rows[0].id);
    return { scopeId, id: rows[0].id };
  });
}

export async function archiveField(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const fieldId = uuid(id);
  const scopeId = uuid(input.scopeId);
  return transaction(settings, 'unoa.catalog.' + scopeId, async store => {
    await requireContext(store, actor, scopeId, 'write');
    const archived = await store.query(`
      UPDATE unoa.academic_field SET status = 'archived' WHERE id = $1 AND owner_scope_id = $2 AND status = 'active'
    `, [fieldId, scopeId]);
    requireConfig(archived.rowCount === 1, 409, 'Ce domaine est déjà archivé ou appartient à une autre structure');
    await audit(store, actor, scopeId, 'catalog.field_archived', correlation, fieldId);
    return { scopeId, id: fieldId };
  });
}

export async function createCourse(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const scopeId = uuid(input.scopeId);
  const item = {
    code: code(input.code), title: boundedText(input.title, 200, 'Intitulé'),
    description: optional(input.description, text(2000, 'Description')),
  };
  return transaction(settings, 'unoa.catalog.' + scopeId, async store => {
    await requireContext(store, actor, scopeId, 'write');
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.course(owner_scope_id, code, title, description, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id
    `, [scopeId, item.code, item.title, item.description, actor]);
    await audit(store, actor, scopeId, 'catalog.course_created', correlation, rows[0].id);
    return { scopeId, id: rows[0].id };
  });
}

export async function createCompetency(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const scopeId = uuid(input.scopeId);
  const item = {
    code: code(input.code), label: boundedText(input.label, 200, 'Libellé'),
    description: optional(input.description, text(2000, 'Description')),
  };
  return transaction(settings, 'unoa.catalog.' + scopeId, async store => {
    await requireContext(store, actor, scopeId, 'write');
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.competency(owner_scope_id, code, label, description, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id
    `, [scopeId, item.code, item.label, item.description, actor]);
    await audit(store, actor, scopeId, 'catalog.competency_created', correlation, rows[0].id);
    return { scopeId, id: rows[0].id };
  });
}

// ------------------------------------------------------------------ programmes

function versionFields(input: Input) {
  return {
    title: boundedText(input.versionTitle ?? input.title, 200, 'Intitulé de version'),
    organisation: boundedText(input.organisation, 120, 'Organisation des périodes'),
    duration: boundedText(input.duration, 120, 'Durée'),
    deliveryMode: boundedText(input.deliveryMode, 120, 'Modalité'),
    creditUnit: boundedText(input.creditUnit, 60, 'Unité de crédit'),
    expectedCredits: optional(input.expectedCredits, value => amount(value, 'Total attendu', true)),
    languages: list(input.languages).map(language),
    capacity: optional(input.capacity, value => integer(value, 'Capacité', 1, 1_000_000)),
    objectives: optional(input.objectives, text(4000, 'Objectifs')),
    admission: optional(input.admission, text(4000, 'Conditions d’admission')),
  };
}

export async function createProgram(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const scopeId = uuid(input.scopeId);
  const item = {
    kind: typeCode(input.kindCode),
    field: optional(input.fieldId, uuid),
    code: code(input.code),
    title: boundedText(input.title, 200, 'Intitulé'),
  };
  const version = versionFields({ ...input, versionTitle: input.title });
  return transaction(settings, 'unoa.catalog.' + scopeId, async store => {
    await requireContext(store, actor, scopeId, 'write');
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.program(owner_scope_id, field_id, kind_code, code, title, created_by)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
    `, [scopeId, item.field, item.kind, item.code, item.title, actor]);
    const versionId = await insertVersion(store, rows[0].id, 1, null, version, actor);
    await audit(store, actor, scopeId, 'catalog.program_created', correlation, rows[0].id);
    return { scopeId, id: rows[0].id, versionId };
  });
}

async function insertVersion(store: Queryable, programId: string, number: number, basedOn: string | null,
  version: ReturnType<typeof versionFields>, actor: string) {
  const { rows } = await store.query<{ id: string }>(`
    INSERT INTO unoa.program_version(program_id, number, based_on, title, organisation, duration, delivery_mode,
      credit_unit, expected_credits, languages, capacity, objectives, admission, author_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id
  `, [programId, number, basedOn, version.title, version.organisation, version.duration, version.deliveryMode,
    version.creditUnit, version.expectedCredits, version.languages, version.capacity, version.objectives,
    version.admission, actor]);
  return rows[0].id;
}

interface ProgramRow {
  id: string; code: string; title: string; owner_scope_id: string; institution_id: string; owner_label: string;
  kind_code: string; kind_label: string; degree_awarding: boolean; field_label: string | null; regulatory_status: string;
  admission_allowed: boolean;
}

async function program(store: Queryable, actor: string, programId: string) {
  const { rows } = await store.query<ProgramRow>(`
    SELECT program.id, program.code, program.title, program.owner_scope_id, program.institution_id,
           owner.label AS owner_label, program.kind_code, kind.label AS kind_label, kind.degree_awarding,
           field.label AS field_label, unoa.program_regulatory_status(program.id) AS regulatory_status,
           unoa.program_admission_allowed(program.id) AS admission_allowed
    FROM unoa.program
    JOIN unoa.program_kind AS kind ON kind.code = program.kind_code
    JOIN unoa.scope AS owner ON owner.id = program.owner_scope_id
    LEFT JOIN unoa.academic_field AS field ON field.id = program.field_id
    WHERE program.id = $2 AND unoa.has_scope_permission($1, 'catalog.read', program.owner_scope_id)
  `, [actor, programId]);
  return rows[0] ?? null;
}

export async function programDetails(settings: IamSettings, actor: string, programId: string) {
  const store = database(settings);
  const item = await program(store, actor, uuid(programId));
  requireConfig(item, 403, 'Programme inaccessible');
  const scope = await context(store, actor, item.owner_scope_id);
  const [labels, versions, authorizations, territories] = await Promise.all([
    store.query<{ language: string; title: string; summary: string | null }>(
      'SELECT language, title, summary FROM unoa.program_label WHERE program_id = $1 ORDER BY language', [item.id],
    ),
    store.query<{ id: string; number: number; state: string; title: string; published_at: Date | null; admission_open: boolean; author_id: string }>(`
      SELECT id, number, state, title, published_at, admission_open, author_id
      FROM unoa.program_version WHERE program_id = $1 ORDER BY number DESC
    `, [item.id]),
    store.query<{
      id: string; status: string; authority: string; evidence: string; territory_label: string | null;
      valid_from: Date; valid_until: Date | null; recorded_by: string; verified_by: string | null; verified_at: Date | null;
    }>(`
      SELECT authorization_record.id, authorization_record.status, authorization_record.authority,
             authorization_record.evidence, zone.label AS territory_label, authorization_record.valid_from,
             authorization_record.valid_until, authorization_record.recorded_by,
             authorization_record.verified_by, authorization_record.verified_at
      FROM unoa.program_authorization AS authorization_record
      LEFT JOIN unoa.scope AS zone ON zone.id = authorization_record.territory_id
      WHERE authorization_record.program_id = $1 ORDER BY authorization_record.valid_from DESC, authorization_record.recorded_at DESC
    `, [item.id]),
    zones(store, item.institution_id, ['territory', 'jurisdiction']),
  ]);
  return { program: item, scope, labels: labels.rows, versions: versions.rows, authorizations: authorizations.rows, territories };
}

// Territories relevant to an establishment: its ancestors and its declared implantations.
async function zones(store: Queryable, institutionId: string, natures: string[]) {
  const { rows } = await store.query<{ id: string; label: string; nature: string }>(`
    WITH RECURSIVE ancestry AS (
      SELECT parent_id AS id FROM unoa.scope WHERE id = $1
      UNION ALL
      SELECT scope.parent_id FROM unoa.scope JOIN ancestry ON scope.id = ancestry.id WHERE scope.parent_id IS NOT NULL
    ), candidates AS (
      SELECT id FROM ancestry
      UNION SELECT territory_id FROM unoa.scope_attachment WHERE scope_id = $1 AND effective_until IS NULL
    )
    SELECT scope.id, scope.label, kind.nature FROM candidates
    JOIN unoa.scope ON scope.id = candidates.id
    JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE kind.nature = ANY($2) ORDER BY scope.label
  `, [institutionId, natures]);
  return rows;
}

export async function setProgramLabel(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const programId = uuid(id);
  const tag = language(input.language);
  const title = boundedText(input.title, 200, 'Intitulé traduit');
  const summary = optional(input.summary, text(2000, 'Résumé'));
  return transaction(settings, 'unoa.catalog.program.' + programId, async store => {
    const item = await program(store, actor, programId);
    requireConfig(item, 403, 'Programme inaccessible');
    await requireContext(store, actor, item.owner_scope_id, 'write');
    await store.query(`
      INSERT INTO unoa.program_label(program_id, language, title, summary) VALUES ($1, $2, $3, $4)
      ON CONFLICT (program_id, language) DO UPDATE SET title = excluded.title, summary = excluded.summary, updated_at = now()
    `, [programId, tag, title, summary]);
    await audit(store, actor, item.owner_scope_id, 'catalog.label_set', correlation, programId);
    return { scopeId: item.owner_scope_id, id: programId };
  });
}

export async function recordAuthorization(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const programId = uuid(id);
  const item = {
    status: choice(input.status, authorizationStatuses, 'Statut réglementaire'),
    authority: boundedText(input.authority, 200, 'Autorité'),
    evidence: boundedText(input.evidence, 1000, 'Pièce justificative'),
    territory: optional(input.territoryId, uuid),
    validFrom: utcTime(input.validFrom),
    validUntil: optional(input.validUntil, utcTime),
  };
  return transaction(settings, 'unoa.catalog.program.' + programId, async store => {
    const found = await program(store, actor, programId);
    requireConfig(found, 403, 'Programme inaccessible');
    await requireContext(store, actor, found.owner_scope_id, 'authorize');
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.program_authorization(program_id, territory_id, status, authority, evidence, valid_from, valid_until, recorded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
    `, [programId, item.territory, item.status, item.authority, item.evidence, item.validFrom, item.validUntil, actor]);
    await audit(store, actor, found.owner_scope_id, 'catalog.authorization_recorded', correlation, rows[0].id);
    return { scopeId: found.owner_scope_id, id: programId };
  });
}

export async function verifyAuthorization(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const authorizationId = uuid(id);
  const programId = uuid(input.programId);
  return transaction(settings, 'unoa.catalog.program.' + programId, async store => {
    const found = await program(store, actor, programId);
    requireConfig(found, 403, 'Programme inaccessible');
    await requireContext(store, actor, found.owner_scope_id, 'authorize');
    const { rows } = await store.query<{ recorded_by: string; verified_by: string | null }>(
      'SELECT recorded_by, verified_by FROM unoa.program_authorization WHERE id = $1 AND program_id = $2 FOR UPDATE',
      [authorizationId, programId],
    );
    requireConfig(rows[0], 404, 'Autorisation introuvable');
    requireConfig(rows[0].verified_by === null, 409, 'Cette autorisation est déjà vérifiée');
    requireConfig(rows[0].recorded_by !== actor, 403, 'La vérification revient à une autre personne');
    await store.query('UPDATE unoa.program_authorization SET verified_by = $2, verified_at = now() WHERE id = $1',
      [authorizationId, actor]);
    await audit(store, actor, found.owner_scope_id, 'catalog.authorization_verified', correlation, authorizationId);
    return { scopeId: found.owner_scope_id, id: programId };
  });
}

// --------------------------------------------------------------------- versions

interface VersionRow {
  id: string; program_id: string; number: number; state: string; title: string; organisation: string;
  duration: string; delivery_mode: string; credit_unit: string; expected_credits: string | null;
  languages: string[]; capacity: number | null; objectives: string | null; admission: string | null;
  author_id: string; reviewer_id: string | null; review_note: string | null; published_at: Date | null;
  admission_open: boolean; row_version: number; based_on: string | null;
}

async function lockVersion(store: PoolClient, actor: string, versionId: string) {
  const { rows } = await store.query<VersionRow>('SELECT * FROM unoa.program_version WHERE id = $1 FOR UPDATE', [versionId]);
  requireConfig(rows[0], 404, 'Version introuvable');
  const found = await program(store, actor, rows[0].program_id);
  requireConfig(found, 403, 'Programme inaccessible');
  return { version: rows[0], program: found };
}

async function curriculum(store: Queryable, versionId: string, expected: string | null): Promise<CurriculumModel> {
  const [periods, groups, units, prerequisites] = await Promise.all([
    store.query<{ ordinal: number; label: string }>(
      'SELECT ordinal, label FROM unoa.program_period WHERE version_id = $1 ORDER BY ordinal', [versionId],
    ),
    store.query<{ id: string; label: string; ordinal: number; min_choices: number; max_choices: number }>(`
      SELECT grp.id, grp.label, period.ordinal, grp.min_choices, grp.max_choices
      FROM unoa.option_group AS grp JOIN unoa.program_period AS period ON period.id = grp.period_id
      WHERE grp.version_id = $1 ORDER BY period.ordinal, grp.label
    `, [versionId]),
    store.query<{ id: string; code: string; title: string; ordinal: number; credits: string; option_group_id: string | null }>(`
      SELECT unit.id, unit.code, unit.title, period.ordinal, unit.credits, unit.option_group_id
      FROM unoa.teaching_unit AS unit JOIN unoa.program_period AS period ON period.id = unit.period_id
      WHERE unit.version_id = $1 ORDER BY period.ordinal, unit.code
    `, [versionId]),
    store.query<{ unit_id: string; required_unit_id: string }>(
      'SELECT unit_id, required_unit_id FROM unoa.unit_prerequisite WHERE version_id = $1', [versionId],
    ),
  ]);
  return {
    periods: periods.rows,
    groups: groups.rows.map(row => ({ id: row.id, label: row.label, periodOrdinal: row.ordinal, min: row.min_choices, max: row.max_choices })),
    units: units.rows.map(row => ({
      id: row.id, code: row.code, title: row.title, periodOrdinal: row.ordinal, credits: Number(row.credits), groupId: row.option_group_id,
    })),
    prerequisites: prerequisites.rows.map(row => ({ unitId: row.unit_id, requiredUnitId: row.required_unit_id })),
    expectedCredits: expected === null ? null : Number(expected),
  };
}

export async function versionDetails(settings: IamSettings, actor: string, versionId: string) {
  const store = database(settings);
  const { rows } = await store.query<VersionRow>('SELECT * FROM unoa.program_version WHERE id = $1', [uuid(versionId)]);
  requireConfig(rows[0], 404, 'Version introuvable');
  const version = rows[0];
  const item = await program(store, actor, version.program_id);
  requireConfig(item, 403, 'Programme inaccessible');
  const scope = await context(store, actor, item.owner_scope_id);
  const model = await curriculum(store, version.id, version.expected_credits);
  const [periods, groups, units, requirements, competencies, territories, equivalences, courses, available, sources] = await Promise.all([
    store.query<{ id: string; ordinal: number; label: string }>(
      'SELECT id, ordinal, label FROM unoa.program_period WHERE version_id = $1 ORDER BY ordinal', [version.id],
    ),
    store.query<{ id: string; period_id: string; label: string; min_choices: number; max_choices: number }>(
      'SELECT id, period_id, label, min_choices, max_choices FROM unoa.option_group WHERE version_id = $1 ORDER BY label', [version.id],
    ),
    store.query<{
      id: string; period_id: string; code: string; title: string; credits: string; coefficient: string;
      option_group_id: string | null; description: string | null;
      volumes: { activity: string; hours: string }[]; courses: { id: string; code: string; title: string; coefficient: string }[];
      requires: string[]; competencies: { id: string; code: string; level: string }[];
    }>(`
      SELECT unit.id, unit.period_id, unit.code, unit.title, unit.credits, unit.coefficient, unit.option_group_id, unit.description,
        coalesce((SELECT jsonb_agg(jsonb_build_object('activity', activity, 'hours', hours) ORDER BY activity)
          FROM unoa.unit_volume WHERE unit_id = unit.id), '[]') AS volumes,
        coalesce((SELECT jsonb_agg(jsonb_build_object('id', course.id, 'code', course.code, 'title', course.title,
          'coefficient', link.coefficient) ORDER BY course.code)
          FROM unoa.unit_course AS link JOIN unoa.course ON course.id = link.course_id WHERE link.unit_id = unit.id), '[]') AS courses,
        coalesce((SELECT jsonb_agg(required_unit_id) FROM unoa.unit_prerequisite WHERE unit_id = unit.id), '[]') AS requires,
        coalesce((SELECT jsonb_agg(jsonb_build_object('id', competency.id, 'code', competency.code, 'level', link.level))
          FROM unoa.unit_competency AS link JOIN unoa.competency ON competency.id = link.competency_id
          WHERE link.unit_id = unit.id), '[]') AS competencies
      FROM unoa.teaching_unit AS unit WHERE unit.version_id = $1 ORDER BY unit.code
    `, [version.id]),
    store.query<{ id: string; kind: string; label: string; credits: string | null; mandatory: boolean; conditions: string | null; period_id: string | null }>(
      'SELECT id, kind, label, credits, mandatory, conditions, period_id FROM unoa.version_requirement WHERE version_id = $1 ORDER BY label',
      [version.id],
    ),
    store.query<{ id: string; code: string; label: string }>(`
      SELECT competency.id, competency.code, competency.label FROM unoa.version_competency AS link
      JOIN unoa.competency ON competency.id = link.competency_id WHERE link.version_id = $1 ORDER BY competency.code
    `, [version.id]),
    store.query<{ id: string; label: string }>(`
      SELECT scope.id, scope.label FROM unoa.version_territory AS link JOIN unoa.scope ON scope.id = link.territory_id
      WHERE link.version_id = $1 ORDER BY scope.label
    `, [version.id]),
    store.query<{ id: string; target_code: string; source_code: string; source_number: number; source_program: string; note: string | null }>(`
      SELECT equivalence.id, target.code AS target_code, source.code AS source_code, source_version.number AS source_number,
             source_program.code AS source_program, equivalence.note
      FROM unoa.unit_equivalence AS equivalence
      JOIN unoa.teaching_unit AS target ON target.id = equivalence.target_unit_id
      JOIN unoa.teaching_unit AS source ON source.id = equivalence.source_unit_id
      JOIN unoa.program_version AS source_version ON source_version.id = equivalence.source_version_id
      JOIN unoa.program AS source_program ON source_program.id = source_version.program_id
      WHERE equivalence.version_id = $1 ORDER BY target.code
    `, [version.id]),
    store.query<{ id: string; code: string; title: string }>(
      'SELECT id, code, title FROM unoa.course WHERE institution_id = $1 ORDER BY code LIMIT 1000', [item.institution_id],
    ),
    store.query<{ id: string; code: string; label: string }>(`
      SELECT id, code, label FROM unoa.competency
      WHERE owner_scope_id IN ($1, $2) ORDER BY code LIMIT 1000
    `, [item.owner_scope_id, item.institution_id]),
    store.query<{ unit_id: string; version_id: string; label: string }>(`
      SELECT unit.id AS unit_id, version.id AS version_id,
             program.code || ' v' || version.number || ' · ' || unit.code || ' ' || unit.title AS label
      FROM unoa.teaching_unit AS unit
      JOIN unoa.program_version AS version ON version.id = unit.version_id
      JOIN unoa.program ON program.id = version.program_id
      WHERE program.institution_id = $1 AND version.state IN ('published', 'retired') AND version.id <> $2
      ORDER BY program.code, version.number DESC, unit.code LIMIT 1000
    `, [item.institution_id, version.id]),
  ]);
  return {
    version, program: item, scope, model, issues: checkCurriculum(model),
    periods: periods.rows, groups: groups.rows, units: units.rows, requirements: requirements.rows,
    competencies: competencies.rows, territories: territories.rows, equivalences: equivalences.rows,
    courses: courses.rows, availableCompetencies: available.rows, equivalenceSources: sources.rows,
    zones: await zones(store, item.institution_id, ['territory']),
  };
}

async function draft(store: PoolClient, actor: string, versionId: string) {
  const found = await lockVersion(store, actor, versionId);
  await requireContext(store, actor, found.program.owner_scope_id, 'write');
  requireConfig(found.version.state === 'draft', 409, 'Seul un brouillon est modifiable');
  return found;
}

type Editor = (store: PoolClient, version: VersionRow, input: Input) => Promise<string | null>;

const editors: Record<string, Editor> = {
  async update(store, version, input) {
    const item = versionFields(input);
    await store.query(`
      UPDATE unoa.program_version SET title = $2, organisation = $3, duration = $4, delivery_mode = $5, credit_unit = $6,
        expected_credits = $7, languages = $8, capacity = $9, objectives = $10, admission = $11 WHERE id = $1
    `, [version.id, item.title, item.organisation, item.duration, item.deliveryMode, item.creditUnit,
      item.expectedCredits, item.languages, item.capacity, item.objectives, item.admission]);
    return version.id;
  },
  async periods(store, version, input) {
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.program_period(version_id, ordinal, label) VALUES ($1, $2, $3) RETURNING id
    `, [version.id, integer(input.ordinal, 'Rang', 1, 100), boundedText(input.label, 120, 'Libellé')]);
    return rows[0].id;
  },
  async groups(store, version, input) {
    const min = integer(input.minChoices, 'Minimum', 0, 100);
    const max = integer(input.maxChoices, 'Maximum', 1, 100);
    requireConfig(max >= min, 400, 'Bornes incohérentes');
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.option_group(version_id, period_id, label, min_choices, max_choices) VALUES ($1, $2, $3, $4, $5) RETURNING id
    `, [version.id, uuid(input.periodId), boundedText(input.label, 160, 'Libellé'), min, max]);
    return rows[0].id;
  },
  async units(store, version, input) {
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.teaching_unit(version_id, period_id, code, title, credits, coefficient, option_group_id, description)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
    `, [version.id, uuid(input.periodId), code(input.code), boundedText(input.title, 200, 'Intitulé'),
      amount(input.credits, 'Crédits'), optional(input.coefficient, value => amount(value, 'Coefficient', true)) ?? 1,
      optional(input.optionGroupId, uuid), optional(input.description, text(2000, 'Description'))]);
    return rows[0].id;
  },
  async volumes(store, version, input) {
    const unitId = uuid(input.unitId);
    await store.query(`
      INSERT INTO unoa.unit_volume(unit_id, version_id, activity, hours) VALUES ($1, $2, $3, $4)
      ON CONFLICT (unit_id, activity) DO UPDATE SET hours = excluded.hours
    `, [unitId, version.id, boundedText(input.activity, 60, 'Activité'), amount(input.hours, 'Volume horaire', true)]);
    return unitId;
  },
  async courses(store, version, input) {
    const unitId = uuid(input.unitId);
    await store.query(`
      INSERT INTO unoa.unit_course(unit_id, version_id, course_id, coefficient, credits) VALUES ($1, $2, $3, $4, $5)
    `, [unitId, version.id, uuid(input.courseId), optional(input.coefficient, value => amount(value, 'Coefficient', true)) ?? 1,
      optional(input.credits, value => amount(value, 'Crédits'))]);
    return unitId;
  },
  async prerequisites(store, version, input) {
    const unitId = uuid(input.unitId);
    await store.query(`
      INSERT INTO unoa.unit_prerequisite(unit_id, required_unit_id, version_id) VALUES ($1, $2, $3)
    `, [unitId, uuid(input.requiredUnitId), version.id]);
    return unitId;
  },
  async competencies(store, version, input) {
    const competencyId = uuid(input.competencyId);
    await store.query(`
      INSERT INTO unoa.version_competency(version_id, competency_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
    `, [version.id, competencyId]);
    if (optionalText(input.unitId) !== null) {
      await store.query(`
        INSERT INTO unoa.unit_competency(unit_id, version_id, competency_id, level) VALUES ($1, $2, $3, $4)
      `, [uuid(input.unitId), version.id, competencyId, boundedText(input.level, 60, 'Niveau')]);
    }
    return competencyId;
  },
  async requirements(store, version, input) {
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.version_requirement(version_id, kind, label, period_id, credits, mandatory, conditions)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
    `, [version.id, choice(input.kind, requirementKinds, 'Nature'), boundedText(input.label, 200, 'Libellé'),
      optional(input.periodId, uuid), optional(input.credits, value => amount(value, 'Crédits')),
      input.mandatory === undefined ? true : flag(input.mandatory), optional(input.conditions, text(2000, 'Conditions'))]);
    return rows[0].id;
  },
  async territories(store, version, input) {
    const territoryId = uuid(input.territoryId);
    await store.query('INSERT INTO unoa.version_territory(version_id, territory_id) VALUES ($1, $2)', [version.id, territoryId]);
    return territoryId;
  },
  async equivalences(store, version, input) {
    const source = typeof input.source === 'string' ? input.source.split(':') : [input.sourceVersionId, input.sourceUnitId];
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.unit_equivalence(version_id, target_unit_id, source_version_id, source_unit_id, note, created_by)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
    `, [version.id, uuid(input.targetUnitId), uuid(source[0]), uuid(source[1]), optional(input.note, text(1000, 'Note')),
      (input as { actor: string }).actor]);
    return rows[0].id;
  },
};

// Removal targets draft content only; each table is listed explicitly.
const removals: Record<string, (store: PoolClient, version: VersionRow, input: Input) => Promise<number>> = {
  async unit(store, version, input) {
    const unitId = uuid(input.itemId);
    for (const table of ['unit_volume', 'unit_course', 'unit_competency']) {
      await store.query(`DELETE FROM unoa.${table} WHERE unit_id = $1 AND version_id = $2`, [unitId, version.id]);
    }
    await store.query('DELETE FROM unoa.unit_prerequisite WHERE (unit_id = $1 OR required_unit_id = $1) AND version_id = $2', [unitId, version.id]);
    await store.query('DELETE FROM unoa.unit_equivalence WHERE target_unit_id = $1 AND version_id = $2', [unitId, version.id]);
    return (await store.query('DELETE FROM unoa.teaching_unit WHERE id = $1 AND version_id = $2', [unitId, version.id])).rowCount ?? 0;
  },
  async prerequisite(store, version, input) {
    return (await store.query('DELETE FROM unoa.unit_prerequisite WHERE unit_id = $1 AND required_unit_id = $2 AND version_id = $3',
      [uuid(input.itemId), uuid(input.requiredUnitId), version.id])).rowCount ?? 0;
  },
  async requirement(store, version, input) {
    return (await store.query('DELETE FROM unoa.version_requirement WHERE id = $1 AND version_id = $2', [uuid(input.itemId), version.id])).rowCount ?? 0;
  },
  async territory(store, version, input) {
    return (await store.query('DELETE FROM unoa.version_territory WHERE territory_id = $1 AND version_id = $2', [uuid(input.itemId), version.id])).rowCount ?? 0;
  },
  async equivalence(store, version, input) {
    return (await store.query('DELETE FROM unoa.unit_equivalence WHERE id = $1 AND version_id = $2', [uuid(input.itemId), version.id])).rowCount ?? 0;
  },
  async group(store, version, input) {
    return (await store.query('DELETE FROM unoa.option_group WHERE id = $1 AND version_id = $2', [uuid(input.itemId), version.id])).rowCount ?? 0;
  },
  async period(store, version, input) {
    return (await store.query('DELETE FROM unoa.program_period WHERE id = $1 AND version_id = $2', [uuid(input.itemId), version.id])).rowCount ?? 0;
  },
};

export async function editVersion(settings: IamSettings, actor: string, id: string, part: string, input: Input, correlation: string) {
  const versionId = uuid(id);
  const editor = editors[part];
  requireConfig(editor, 404, 'Opération inconnue');
  return transaction(settings, 'unoa.catalog.version.' + versionId, async store => {
    const { version, program: item } = await draft(store, actor, versionId);
    const target = await editor(store, version, { ...input, actor });
    await audit(store, actor, item.owner_scope_id, 'catalog.version_edited', correlation, target);
    return { scopeId: item.owner_scope_id, id: versionId };
  });
}

export async function removeFromVersion(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const versionId = uuid(id);
  const remove = removals[String(input.kind)];
  requireConfig(remove, 400, 'Élément inconnu');
  return transaction(settings, 'unoa.catalog.version.' + versionId, async store => {
    const { version, program: item } = await draft(store, actor, versionId);
    requireConfig(await remove(store, version, input) === 1, 404, 'Élément introuvable dans ce brouillon');
    await audit(store, actor, item.owner_scope_id, 'catalog.version_edited', correlation, versionId);
    return { scopeId: item.owner_scope_id, id: versionId };
  });
}

export async function transitionVersion(settings: IamSettings, actor: string, id: string, action: string, input: Input, correlation: string) {
  const versionId = uuid(id);
  return transaction(settings, 'unoa.catalog.version.' + versionId, async store => {
    const { version, program: item } = await lockVersion(store, actor, versionId);
    const owner = item.owner_scope_id;
    let event: string;
    if (action === 'submit') {
      await requireContext(store, actor, owner, 'write');
      requireConfig(version.state === 'draft', 409, 'Seul un brouillon est soumis');
      const issues = checkCurriculum(await curriculum(store, version.id, version.expected_credits));
      requireConfig(issues.length === 0, 422, 'La maquette présente des incohérences');
      await store.query("UPDATE unoa.program_version SET state = 'review', submitted_at = now(), review_note = NULL WHERE id = $1", [version.id]);
      event = 'catalog.version_submitted';
    } else if (action === 'review') {
      await requireContext(store, actor, owner, 'review');
      requireConfig(version.state === 'review', 409, 'Cette version n’est pas en revue');
      requireConfig(version.author_id !== actor, 403, 'La revue revient à une autre personne que l’auteur');
      const decision = choice(input.decision, ['approve', 'reject'] as const, 'Décision');
      const note = optional(input.note, text(1000, 'Observation'));
      requireConfig(decision === 'approve' || note, 400, 'Motiver le renvoi en brouillon');
      await store.query(`
        UPDATE unoa.program_version SET state = $2, reviewer_id = $3, reviewed_at = now(), review_note = $4 WHERE id = $1
      `, [version.id, decision === 'approve' ? 'approved' : 'draft', actor, note]);
      event = 'catalog.version_reviewed';
    } else if (action === 'publish') {
      await requireContext(store, actor, owner, 'publish');
      requireConfig(version.state === 'approved', 409, 'Seule une version approuvée est publiée');
      await store.query("UPDATE unoa.program_version SET state = 'retired' WHERE program_id = $1 AND state = 'published'", [item.id]);
      await store.query(`
        UPDATE unoa.program_version SET state = 'published', publisher_id = $2, published_at = now() WHERE id = $1
      `, [version.id, actor]);
      event = 'catalog.version_published';
    } else if (action === 'admission') {
      await requireContext(store, actor, owner, 'publish');
      requireConfig(version.state === 'published', 409, 'Seule la version publiée ouvre aux candidatures');
      const open = flag(input.open);
      requireConfig(!open || item.admission_allowed, 422, 'Aucune autorisation vérifiée ne permet d’ouvrir les candidatures');
      await store.query(`
        UPDATE unoa.program_version SET admission_open = $2, admission_changed_by = $3, admission_changed_at = now() WHERE id = $1
      `, [version.id, open, actor]);
      event = 'catalog.admission_changed';
    } else if (action === 'derive') {
      await requireContext(store, actor, owner, 'write');
      requireConfig(version.state === 'published' || version.state === 'retired', 409, 'Une nouvelle version part d’une version publiée');
      const { rows } = await store.query<{ next: number }>(
        'SELECT max(number) + 1 AS next FROM unoa.program_version WHERE program_id = $1', [item.id],
      );
      const created = await insertVersion(store, item.id, rows[0].next, version.id, {
        title: version.title, organisation: version.organisation, duration: version.duration,
        deliveryMode: version.delivery_mode, creditUnit: version.credit_unit,
        expectedCredits: version.expected_credits === null ? null : Number(version.expected_credits),
        languages: version.languages, capacity: version.capacity, objectives: version.objectives, admission: version.admission,
      }, actor);
      await copyCurriculum(store, version.id, created);
      await audit(store, actor, owner, 'catalog.version_created', correlation, created);
      return { scopeId: owner, id: created };
    } else {
      throw new ConfigProblem(404, 'Opération inconnue');
    }
    await audit(store, actor, owner, event, correlation, version.id);
    return { scopeId: owner, id: version.id };
  });
}

// A new version starts as a faithful draft copy; the published one stays untouched.
async function copyCurriculum(store: PoolClient, from: string, to: string) {
  const map = new Map<string, string>();
  const fresh = (old: string) => {
    if (!map.has(old)) map.set(old, randomUUID());
    return map.get(old)!;
  };
  const periods = await store.query('SELECT id, ordinal, label FROM unoa.program_period WHERE version_id = $1', [from]);
  for (const row of periods.rows) {
    await store.query('INSERT INTO unoa.program_period(id, version_id, ordinal, label) VALUES ($1, $2, $3, $4)',
      [fresh(row.id), to, row.ordinal, row.label]);
  }
  const groups = await store.query('SELECT * FROM unoa.option_group WHERE version_id = $1', [from]);
  for (const row of groups.rows) {
    await store.query(`
      INSERT INTO unoa.option_group(id, version_id, period_id, label, min_choices, max_choices) VALUES ($1, $2, $3, $4, $5, $6)
    `, [fresh(row.id), to, fresh(row.period_id), row.label, row.min_choices, row.max_choices]);
  }
  const units = await store.query('SELECT * FROM unoa.teaching_unit WHERE version_id = $1', [from]);
  for (const row of units.rows) {
    await store.query(`
      INSERT INTO unoa.teaching_unit(id, version_id, period_id, code, title, credits, coefficient, option_group_id, description)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [fresh(row.id), to, fresh(row.period_id), row.code, row.title, row.credits, row.coefficient,
      row.option_group_id ? fresh(row.option_group_id) : null, row.description]);
  }
  await store.query(`
    INSERT INTO unoa.unit_volume(unit_id, version_id, activity, hours)
    SELECT (mapping.value)::uuid, $2, volume.activity, volume.hours FROM unoa.unit_volume AS volume
    JOIN jsonb_each_text($3::jsonb) AS mapping ON mapping.key = volume.unit_id::text WHERE volume.version_id = $1
  `, [from, to, JSON.stringify(Object.fromEntries(map))]);
  await store.query(`
    INSERT INTO unoa.unit_course(unit_id, version_id, course_id, coefficient, credits)
    SELECT (mapping.value)::uuid, $2, link.course_id, link.coefficient, link.credits FROM unoa.unit_course AS link
    JOIN jsonb_each_text($3::jsonb) AS mapping ON mapping.key = link.unit_id::text WHERE link.version_id = $1
  `, [from, to, JSON.stringify(Object.fromEntries(map))]);
  await store.query(`
    INSERT INTO unoa.unit_prerequisite(unit_id, required_unit_id, version_id)
    SELECT (own.value)::uuid, (required.value)::uuid, $2 FROM unoa.unit_prerequisite AS link
    JOIN jsonb_each_text($3::jsonb) AS own ON own.key = link.unit_id::text
    JOIN jsonb_each_text($3::jsonb) AS required ON required.key = link.required_unit_id::text
    WHERE link.version_id = $1
  `, [from, to, JSON.stringify(Object.fromEntries(map))]);
  await store.query(`
    INSERT INTO unoa.version_competency(version_id, competency_id)
    SELECT $2, competency_id FROM unoa.version_competency WHERE version_id = $1
  `, [from, to]);
  await store.query(`
    INSERT INTO unoa.unit_competency(unit_id, version_id, competency_id, level)
    SELECT (mapping.value)::uuid, $2, link.competency_id, link.level FROM unoa.unit_competency AS link
    JOIN jsonb_each_text($3::jsonb) AS mapping ON mapping.key = link.unit_id::text WHERE link.version_id = $1
  `, [from, to, JSON.stringify(Object.fromEntries(map))]);
  await store.query(`
    INSERT INTO unoa.version_requirement(version_id, kind, label, period_id, credits, mandatory, conditions)
    SELECT $2, kind, label, (SELECT (value)::uuid FROM jsonb_each_text($3::jsonb) WHERE key = period_id::text),
           credits, mandatory, conditions FROM unoa.version_requirement WHERE version_id = $1
  `, [from, to, JSON.stringify(Object.fromEntries(map))]);
  await store.query(`
    INSERT INTO unoa.version_territory(version_id, territory_id) SELECT $2, territory_id FROM unoa.version_territory WHERE version_id = $1
  `, [from, to]);
}

export async function simulateVersion(settings: IamSettings, actor: string, id: string, input: Input) {
  const versionId = uuid(id);
  const store = database(settings);
  const { rows } = await store.query<VersionRow>('SELECT * FROM unoa.program_version WHERE id = $1', [versionId]);
  requireConfig(rows[0], 404, 'Version introuvable');
  requireConfig(await program(store, actor, rows[0].program_id), 403, 'Programme inaccessible');
  const chosen = typeof input.choices === 'string' ? [input.choices] : input.choices ?? [];
  requireConfig(Array.isArray(chosen) && chosen.length <= 200, 400, 'Choix invalides');
  return simulatePlan(await curriculum(store, versionId, rows[0].expected_credits), chosen.map(uuid));
}

// ------------------------------------------------------------------ public read

export interface PublicProgram {
  program_id: string; version_id: string; version_number: number; code: string; title: string; kind_label: string;
  degree_awarding: boolean; field_label: string | null; institution_label: string; owner_label: string;
  delivery_mode: string; duration: string; languages: string[]; territories: string[];
  regulatory_status: string; admission_open: boolean; published_at: Date;
}

export async function publicPrograms(settings: IamSettings) {
  const { rows } = await database(settings).query<PublicProgram>('SELECT * FROM unoa.public_programs()');
  return rows;
}

export interface PublicSheet {
  program: {
    id: string; code: string; kind: string; degreeAwarding: boolean; field: string | null; institution: string; owner: string;
    regulatoryStatus: string; admissionOpen: boolean; labels: { language: string; title: string; summary: string | null }[];
  };
  version: {
    id: string; number: number; title: string; organisation: string; duration: string; deliveryMode: string;
    creditUnit: string; expectedCredits: number | null; languages: string[]; capacity: number | null;
    objectives: string | null; admission: string | null; publishedAt: string;
  };
  territories: string[];
  competencies: { code: string; label: string }[];
  requirements: { kind: string; label: string; credits: number | null; mandatory: boolean }[];
  periods: {
    ordinal: number; label: string; groups: { id: string; label: string; min: number; max: number }[];
    units: {
      id: string; code: string; title: string; credits: number; coefficient: number; groupId: string | null;
      volumes: { activity: string; hours: number }[]; courses: { code: string; title: string }[]; requires: string[];
    }[];
  }[];
}

export async function publicSheet(settings: IamSettings, programId: string) {
  const { rows } = await database(settings).query<{ sheet: PublicSheet | null }>(
    'SELECT unoa.public_program_sheet($1) AS sheet', [programId],
  );
  return rows[0]?.sheet ?? null;
}

export function sheetModel(sheet: PublicSheet): CurriculumModel {
  return {
    periods: sheet.periods.map(period => ({ ordinal: period.ordinal, label: period.label })),
    groups: sheet.periods.flatMap(period => period.groups.map(group => ({ ...group, periodOrdinal: period.ordinal }))),
    units: sheet.periods.flatMap(period => period.units.map(unit => ({
      id: unit.id, code: unit.code, title: unit.title, periodOrdinal: period.ordinal,
      credits: Number(unit.credits), groupId: unit.groupId,
    }))),
    prerequisites: sheet.periods.flatMap(period => period.units.flatMap(unit =>
      unit.requires.map(required => ({ unitId: unit.id, requiredUnitId: required })))),
    expectedCredits: sheet.version.expectedCredits === null ? null : Number(sheet.version.expectedCredits),
  };
}
