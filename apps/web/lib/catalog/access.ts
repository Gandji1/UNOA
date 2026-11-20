import 'server-only';
// Access to catalogue objects: every read and write is resolved against the
// owner scope (establishment or academic unit) through has_scope_permission.
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { ensure } from '@/lib/shared/validation';
import type { Queryable } from '@/lib/server/db';

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

export const contextFields = `
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

export async function context(store: Queryable, actor: string, scopeId: string) {
  const { rows } = await store.query<CatalogScope>(`
    SELECT ${contextFields}
    WHERE scope.id = $2 AND kind.nature IN ('institution', 'academic_unit')
      AND unoa.has_scope_permission($1, 'catalog.read', scope.id)
  `, [actor, scopeId]);
  return rows[0] ?? null;
}

export async function requireContext(store: Queryable, actor: string, scopeId: string, right: 'write' | 'review' | 'publish' | 'authorize') {
  const scope = await context(store, actor, scopeId);
  ensure(scope?.[right], 403, 'Action non autorisée dans cette structure');
  return scope;
}


export interface ProgramRow {
  id: string; code: string; title: string; owner_scope_id: string; institution_id: string; owner_label: string;
  kind_code: string; kind_label: string; degree_awarding: boolean; field_label: string | null; regulatory_status: string;
  admission_allowed: boolean;
}

export async function program(store: Queryable, actor: string, programId: string) {
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


// Territories relevant to an establishment: its ancestors and its declared implantations.
export async function zones(store: Queryable, institutionId: string, natures: string[]) {
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

