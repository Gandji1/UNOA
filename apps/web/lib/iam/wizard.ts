import 'server-only';
import type { IamSettings } from './settings';
import { database } from './sessions';

// Creation assistants: for each kind of object, only the places where the
// person may create it and the types allowed there. Every write still goes
// through the module's own API, which checks the rights again.

export type WizardKind = 'pays' | 'etablissement' | 'campus' | 'faculte' | 'departement' | 'filiere' | 'formation' | 'matiere' | 'responsable';

export const wizardKinds: { kind: WizardKind; title: string; help: string; who: string }[] = [
  { kind: 'pays', title: 'Créer un pays', help: 'Ensuite : nommer l’administrateur du pays.', who: 'Super-administrateur' },
  { kind: 'etablissement', title: 'Créer un établissement', help: 'Une université ou un institut. Ensuite : nommer son recteur.', who: 'Administrateur pays' },
  { kind: 'campus', title: 'Créer un campus', help: 'Un site rattaché à l’établissement.', who: 'Recteur' },
  { kind: 'faculte', title: 'Créer une faculté', help: 'Ensuite : nommer son doyen.', who: 'Recteur' },
  { kind: 'departement', title: 'Créer un département', help: 'Ensuite : nommer son chef de département.', who: 'Doyen' },
  { kind: 'filiere', title: 'Créer une filière ou une spécialité', help: 'Par exemple : Économie appliquée, Comptabilité-Contrôle-Audit.', who: 'Chef de département' },
  { kind: 'formation', title: 'Créer une formation', help: 'Licence, master, certificat… puis sa maquette.', who: 'Chef de département' },
  { kind: 'matiere', title: 'Créer une matière', help: 'Un cours, rattaché ensuite à la maquette.', who: 'Chef de département' },
  { kind: 'responsable', title: 'Nommer une personne', help: 'Le responsable du niveau suivant ou un collaborateur.', who: 'Chaque responsable' },
];

interface Place { id: string; label: string; nature: string; path: string }

// Scopes where the actor holds a permission, with a readable path ("Pays › Université › Faculté").
async function places(settings: IamSettings, actor: string, permission: string, natures: string[], cascade: string | null = null) {
  const { rows } = await database(settings).query<Place>(`
    WITH RECURSIVE tree AS (
      SELECT id, label, parent_id, type_code, label::text AS path FROM unoa.scope WHERE parent_id IS NULL
      UNION ALL SELECT scope.id, scope.label, scope.parent_id, scope.type_code, CASE WHEN tree.parent_id IS NULL THEN scope.label ELSE tree.path || ' › ' || scope.label END
      FROM unoa.scope JOIN tree ON scope.parent_id = tree.id
    )
    SELECT tree.id, tree.label, kind.nature, CASE WHEN tree.parent_id IS NULL THEN tree.label ELSE tree.path END AS path
    FROM tree JOIN unoa.scope_type AS kind ON kind.code = tree.type_code
    LEFT JOIN unoa.org_unit AS unit ON unit.scope_id = tree.id
    WHERE kind.nature = ANY($3::text[]) AND (unit.scope_id IS NULL OR unit.status = 'active')
      AND CASE WHEN $4::text IS NULL THEN unoa.has_scope_permission($1, $2, tree.id)
        WHEN $4 = 'naming' THEN unoa.holds_here($1, $2, tree.id) OR unoa.holds_here($1, $2, unoa.cascade_anchor(tree.parent_id))
        ELSE unoa.may_create($1, $2, tree.id, $4) END
    ORDER BY path LIMIT 300
  `, [actor, permission, natures, cascade]);
  return rows;
}

// Child types of a given nature allowed under a parent scope.
async function childTypes(settings: IamSettings, parentId: string, nature: string) {
  const { rows } = await database(settings).query<{ code: string; label: string }>(`
    SELECT child.code, child.label FROM unoa.scope AS parent
    JOIN unoa.scope_type_parent AS rule ON rule.parent_type_code = parent.type_code
    JOIN unoa.scope_type AS child ON child.code = rule.type_code
    WHERE parent.id = $1 AND child.nature = $2 ORDER BY child.label
  `, [parentId, nature]);
  return rows;
}

const scopeKinds: Partial<Record<WizardKind, { permission: string; parents: string[]; nature: string; cascade: string }>> = {
  pays: { permission: 'territory.write', parents: ['platform', 'territory'], nature: 'territory', cascade: 'territory' },
  etablissement: { permission: 'territory.write', parents: ['territory', 'jurisdiction'], nature: 'institution', cascade: 'institution' },
  campus: { permission: 'territory.write', parents: ['institution'], nature: 'centre', cascade: 'centre' },
  faculte: { permission: 'org.write', parents: ['institution', 'centre'], nature: 'academic_unit', cascade: 'faculty' },
  departement: { permission: 'org.write', parents: ['academic_unit'], nature: 'academic_unit', cascade: 'department' },
};

export async function wizardData(settings: IamSettings, actor: string, kind: WizardKind, parent?: string) {
  const store = database(settings);
  const scoped = scopeKinds[kind];
  if (scoped) {
    const parents = await places(settings, actor, scoped.permission, scoped.parents, scoped.cascade);
    const chosen = parents.find(item => item.id === parent) ?? (parents.length === 1 ? parents[0] : undefined);
    const types = chosen ? await childTypes(settings, chosen.id, scoped.nature) : [];
    const pending = scoped.nature === 'academic_unit' ? (await store.query<{ id: string; label: string; type_label: string; parent_label: string }>(`
      SELECT scope.id, scope.label, kind.label AS type_label, parent.label AS parent_label FROM unoa.org_unit AS unit
      JOIN unoa.scope ON scope.id = unit.scope_id JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
      JOIN unoa.scope AS parent ON parent.id = scope.parent_id
      WHERE unit.status = 'proposed' AND unit.proposed_by <> $1 AND unoa.has_scope_permission($1, 'org.approve', scope.id)
      ORDER BY scope.created_at LIMIT 50`, [actor])).rows : [];
    const mine = scoped.nature === 'academic_unit' ? (await store.query<{ id: string; label: string; type_label: string }>(`
      SELECT scope.id, scope.label, kind.label AS type_label FROM unoa.org_unit AS unit JOIN unoa.scope ON scope.id = unit.scope_id
      JOIN unoa.scope_type AS kind ON kind.code = scope.type_code WHERE unit.status = 'proposed' AND unit.proposed_by = $1 LIMIT 50`, [actor])).rows : [];
    return { kind, parents, chosen, types, pending, mine };
  }
  if (kind === 'filiere' || kind === 'formation' || kind === 'matiere') {
    const owners = await places(settings, actor, 'catalog.write', ['academic_unit'], 'catalog');
    const chosen = owners.find(item => item.id === parent) ?? (owners.length === 1 ? owners[0] : undefined);
    const [fieldTypes, kinds, fields] = await Promise.all([
      store.query<{ code: string; label: string; root_allowed: boolean; parents: string[] }>(`
        SELECT kind.code, kind.label, kind.root_allowed, coalesce(array_agg(rule.parent_type_code) FILTER (WHERE rule.parent_type_code IS NOT NULL), '{}') AS parents
        FROM unoa.field_type AS kind LEFT JOIN unoa.field_type_parent AS rule ON rule.type_code = kind.code GROUP BY kind.code ORDER BY kind.label`),
      store.query<{ code: string; label: string; degree_awarding: boolean }>('SELECT code, label, degree_awarding FROM unoa.program_kind ORDER BY label'),
      chosen ? store.query<{ id: string; label: string; code: string; type_code: string }>(`
        SELECT id, label, code, type_code FROM unoa.academic_field WHERE institution_id = (SELECT unoa.nearest_institution($1)) AND status = 'active' ORDER BY label`, [chosen.id])
        : Promise.resolve({ rows: [] as { id: string; label: string; code: string; type_code: string }[] }),
    ]);
    return { kind, owners, chosen, fieldTypes: fieldTypes.rows, programKinds: kinds.rows, fields: fields.rows };
  }
  // responsable
  const scopes = await places(settings, actor, 'iam.assign', ['platform', 'territory', 'jurisdiction', 'institution', 'centre', 'academic_unit'], 'naming');
  const chosen = scopes.find(item => item.id === parent) ?? (scopes.length === 1 ? scopes[0] : undefined);
  const roles = chosen ? (await store.query<{ code: string; label: string | null; description: string | null }>(`
    SELECT role.code, role.label, role.description FROM unoa.access_role AS role, unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE scope.id = $2 AND role.archived_at IS NULL AND unoa.can_grant($1, role.code, $2) AND unoa.cascade_allows($1, role.code, $2)
      AND CASE role.level WHEN 'platform' THEN scope.parent_id IS NULL WHEN 'territory' THEN kind.nature IN ('territory', 'jurisdiction')
        WHEN 'institution' THEN kind.nature IN ('institution', 'centre', 'academic_unit') ELSE kind.nature = 'academic_unit' END
    ORDER BY role.ordinal`, [actor, chosen.id])).rows : [];
  return { kind, scopes, chosen, roles };
}

// The standard reference types the super-administrator may create in one click
// (they become ordinary data, editable afterwards; nothing is hard-coded in use).
export const standardTypes = {
  scopes: [
    { code: 'pays', label: 'Pays', nature: 'territory', parents: ['@root'] },
    { code: 'universite', label: 'Université', nature: 'institution', parents: ['pays'] },
    { code: 'campus', label: 'Campus', nature: 'centre', parents: ['universite'] },
    { code: 'faculte', label: 'Faculté', nature: 'academic_unit', parents: ['universite'] },
    { code: 'departement', label: 'Département', nature: 'academic_unit', parents: ['faculte'] },
  ],
  fields: [
    { code: 'filiere', label: 'Filière', rootAllowed: true, parents: [] as string[] },
    { code: 'specialite', label: 'Spécialité', rootAllowed: false, parents: ['filiere'] },
  ],
  programs: [
    { code: 'licence', label: 'Licence', degreeAwarding: true }, { code: 'master', label: 'Master', degreeAwarding: true },
    { code: 'doctorat', label: 'Doctorat', degreeAwarding: true }, { code: 'certificat', label: 'Certificat', degreeAwarding: false },
  ],
};
