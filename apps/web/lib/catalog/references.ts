import 'server-only';
// Catalogue references: programme natures and taxonomy types (platform root),
// then fields, courses and competencies owned by an establishment or a unit.
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { amount, boundedText, businessCode, choice, ensure, flag, integer, list, optional, optionalText, Problem, text, utcTime, uuid, type Input } from '@/lib/shared/validation';
import { typeCode } from '@/lib/territory/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { context, requireContext } from './access';

export async function catalogOverview(settings: IamSettings, actor: string, scopeId: string) {
  const store = database(settings);
  const scope = await context(store, actor, uuid(scopeId));
  ensure(scope, 403, 'Structure inaccessible');
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
  ensure(rows[0]?.allowed, 403, 'Définition réservée à la racine de la plateforme');
  return rows[0].root;
}

export async function defineFieldType(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const item = {
    code: typeCode(input.code),
    label: boundedText(input.label, 120, 'Libellé'),
    rootAllowed: flag(input.rootAllowed),
    parents: list(input.parentTypes).map(value => typeCode(value)),
  };
  ensure(item.rootAllowed || item.parents.length > 0, 400, 'Indiquer un type parent ou autoriser la racine');
  return transaction(settings, 'unoa.catalog.types', async store => {
    const root = await requireDefine(store, actor);
    const created = await store.query(
      'INSERT INTO unoa.field_type(code, label, root_allowed) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING',
      [item.code, item.label, item.rootAllowed],
    );
    ensure(created.rowCount === 1, 409, 'Ce type existe déjà');
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
    ensure(created.rowCount === 1, 409, 'Cette nature de programme existe déjà');
    await audit(store, actor, root, 'catalog.kind_defined', correlation);
    return { code: item.code };
  });
}

export async function createField(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const scopeId = uuid(input.scopeId);
  const item = {
    type: typeCode(input.typeCode),
    parent: optional(input.parentId, uuid),
    code: businessCode(input.code),
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
    ensure(archived.rowCount === 1, 409, 'Ce domaine est déjà archivé ou appartient à une autre structure');
    await audit(store, actor, scopeId, 'catalog.field_archived', correlation, fieldId);
    return { scopeId, id: fieldId };
  });
}

export async function createCourse(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const scopeId = uuid(input.scopeId);
  const item = {
    code: businessCode(input.code), title: boundedText(input.title, 200, 'Intitulé'),
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
    code: businessCode(input.code), label: boundedText(input.label, 200, 'Libellé'),
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

