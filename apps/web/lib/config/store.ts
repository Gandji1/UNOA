import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { resolveParameter, type ParameterVersion } from '@unoa/config';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { definitionInput, keyName, typedValue } from './validation';
import { boundedText, ensure, utcTime, uuid, type Input } from '@/lib/shared/validation';
import type { ConfigKind, ConfigValue } from './validation';


interface Scope {
  id: string;
  label: string;
  type_code: string;
  root: boolean;
  define: boolean;
  write: boolean;
  review: boolean;
  publish: boolean;
}

export interface Definition {
  key: string;
  label: string;
  description: string;
  kind: ConfigKind;
  default_value: ConfigValue | null;
  minimum: string | null;
  maximum: string | null;
  choices: string[];
  allowed_types: string[];
  inherits: boolean;
  allow_override: boolean;
}

export interface Version {
  id: string;
  version: number;
  definition_key: string;
  scope_id: string;
  value: ConfigValue;
  reason: string;
  state: 'draft' | 'review' | 'approved' | 'published';
  effective_from: Date;
  author_id: string;
  reviewed_against: number | null;
}

const scopeFields = `
  scope.id, scope.label, scope.type_code, scope.parent_id IS NULL AS root,
  unoa.has_scope_permission($1, 'config.define', scope.id) AS define,
  unoa.has_scope_permission($1, 'config.write', scope.id) AS write,
  unoa.has_scope_permission($1, 'config.review', scope.id) AS review,
  unoa.has_scope_permission($1, 'config.publish', scope.id) AS publish
`;

export async function readableScopes(settings: IamSettings, actor: string, after?: string) {
  const { rows } = await database(settings).query<Scope>(`
    SELECT ${scopeFields}
    FROM unoa.scope AS scope
    WHERE ($2::uuid IS NULL OR scope.id > $2)
      AND unoa.has_scope_permission($1, 'config.read', scope.id)
    ORDER BY scope.id LIMIT 51
  `, [actor, after || null]);
  return rows;
}

async function getScope(store: Queryable, actor: string, scopeId: string) {
  const { rows } = await store.query<Scope>(`
    SELECT ${scopeFields}
    FROM unoa.scope AS scope
    WHERE scope.id = $2 AND unoa.has_scope_permission($1, 'config.read', scope.id)
  `, [actor, scopeId]);
  return rows[0] ?? null;
}

export async function scopeTypes(settings: IamSettings) {
  const { rows } = await database(settings).query<{ code: string; label: string }>(
    'SELECT code, label FROM unoa.scope_type ORDER BY label, code',
  );
  return rows;
}

export async function catalogue(settings: IamSettings, actor: string, scopeId: string, after?: string) {
  const store = database(settings);
  const scope = await getScope(store, actor, scopeId);
  ensure(scope, 403, 'Périmètre inaccessible');
  const { rows } = await store.query<Definition>(`
    SELECT key, label, description, kind, default_value, minimum, maximum,
           choices, allowed_types, inherits, allow_override
    FROM unoa.config_definition
    WHERE ($1::text IS NULL OR key > $1)
      AND (inherits OR $2 = ANY(allowed_types))
    ORDER BY key LIMIT 25
  `, [after || null, scope.type_code]);
  return { scope, definitions: rows };
}

async function definition(store: Queryable, key: string) {
  const { rows } = await store.query<Definition>('SELECT * FROM unoa.config_definition WHERE key = $1', [key]);
  ensure(rows[0], 404, 'Paramètre introuvable');
  return rows[0];
}

async function effective(store: Queryable, def: Definition, scopeId: string, at: string) {
  const { rows } = await store.query<Version & { label: string; depth: number }>(`
    WITH RECURSIVE ancestry AS (
      SELECT id, parent_id, label, 0 AS depth FROM unoa.scope WHERE id = $1
      UNION ALL
      SELECT parent.id, parent.parent_id, parent.label, ancestry.depth + 1
      FROM unoa.scope AS parent JOIN ancestry ON parent.id = ancestry.parent_id
      WHERE $4
    )
    SELECT selected.*, ancestry.label, ancestry.depth
    FROM ancestry
    CROSS JOIN LATERAL (
      SELECT * FROM unoa.config_value
      WHERE scope_id = ancestry.id AND definition_key = $2 AND state = 'published' AND effective_from <= $3
      ORDER BY effective_from DESC, version DESC LIMIT 1
    ) AS selected
    ORDER BY ancestry.depth
  `, [scopeId, def.key, at, def.inherits]);
  const candidates: ParameterVersion<ConfigValue>[] = rows.map(row => ({
    key: def.key, scope: row.scope_id, effectiveFrom: row.effective_from.toISOString(),
    state: 'published', version: row.version, value: row.value,
  }));
  const selected = resolveParameter(def.key, rows.map(row => row.scope_id), at, candidates);
  const origin = selected ? rows.find(row => row.version === selected.version) : null;
  return {
    value: selected?.value ?? def.default_value,
    source: origin ? { scope: origin.label, version: origin.version, effectiveFrom: origin.effective_from, reason: origin.reason } : null,
  };
}

export async function resolveConfiguration(settings: IamSettings, actor: string, scopeId: string, key: string, at: string) {
  const store = database(settings);
  const scope = await getScope(store, actor, scopeId);
  ensure(scope, 403, 'Périmètre inaccessible');
  const def = await definition(store, key);
  ensure(def.inherits || def.allowed_types.includes(scope.type_code), 404, 'Paramètre introuvable');
  return { key, scopeId, at, ...(await effective(store, def, scopeId, at)) };
}

export async function configurationDetails(
  settings: IamSettings, actor: string, scope: Scope, key: string, at: string, previewId?: string, before?: number,
) {
  const store = database(settings);
  ensure(await getScope(store, actor, scope.id), 403, 'Périmètre inaccessible');
  const def = await definition(store, key);
  ensure(def.inherits || def.allowed_types.includes(scope.type_code), 404, 'Paramètre introuvable');
  const result = await effective(store, def, scope.id, at);
  const { rows: versions } = await store.query<Version>(`
    SELECT * FROM unoa.config_value WHERE definition_key = $1 AND scope_id = $2
      AND ($3::integer IS NULL OR version < $3)
    ORDER BY version DESC LIMIT 25
  `, [key, scope.id, before ?? null]);
  let preview: { proposal: Version; previous: Awaited<ReturnType<typeof effective>> } | null = null;
  if (previewId) {
    const { rows } = await store.query<Version>(`
      SELECT * FROM unoa.config_value WHERE definition_key = $1 AND scope_id = $2 AND id = $3
    `, [key, scope.id, previewId]);
    const proposal = rows[0];
    if (proposal && proposal.state !== 'published') {
      const previous = await effective(store, def, scope.id, proposal.effective_from.toISOString());
      preview = { proposal, previous };
    }
  }
  return { definition: def, result, versions: versions.slice(0, 24), next: versions.length > 24 ? versions[23].version : null, preview };
}




export async function createDefinition(settings: IamSettings, actor: string, input: Input, form: boolean, correlation: string) {
  const scopeId = uuid(input.scopeId);
  const item = definitionInput(input, form);
  return transaction(settings, 'unoa.config.' + item.key, async store => {
    const scope = await getScope(store, actor, scopeId);
    ensure(scope?.root && scope.define, 403, 'Création de définition non autorisée');
    const { rows } = await store.query<{ count: number }>(
      'SELECT count(*)::int FROM unoa.scope_type WHERE code = ANY($1)', [item.types],
    );
    ensure(rows[0].count === item.types.length, 400, 'Type de périmètre inconnu');
    const result = await store.query(`
      INSERT INTO unoa.config_definition
        (key, label, description, kind, default_value, minimum, maximum, choices, allowed_types, inherits, allow_override, author_id)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (key) DO NOTHING
    `, [item.key, item.label, item.description, item.kind, item.defaultValue === null ? null : JSON.stringify(item.defaultValue),
      item.minimum, item.maximum, item.options, item.types, item.inherits, item.allowOverride, actor]);
    ensure(result.rowCount === 1, 409, 'Cette clé existe déjà');
    await audit(store, actor, scopeId, 'config.definition_created', correlation);
    return { key: item.key, scopeId };
  });
}

export async function createValue(settings: IamSettings, actor: string, input: Input, form: boolean, correlation: string) {
  const scopeId = uuid(input.scopeId);
  const requestId = uuid(input.requestId);
  const key = keyName(input.key);
  const reason = boundedText(input.reason, 500, 'Justification');
  const effectiveFrom = utcTime(input.effectiveFrom);
  return transaction(settings, 'unoa.config.' + key, async store => {
    const scope = await getScope(store, actor, scopeId);
    ensure(scope?.write, 403, 'Rédaction non autorisée');
    const def = await definition(store, key);
    ensure(def.allowed_types.includes(scope.type_code) && (def.allow_override || scope.root), 422, 'Surcharge interdite pour ce périmètre');
    const value = typedValue(def.kind, input.value, form);
    const json = JSON.stringify(value);
    const prior = await store.query<Version & { identical: boolean }>(`
      SELECT *, (definition_key = $2 AND scope_id = $3 AND value = $4::jsonb AND reason = $5
        AND effective_from = $6 AND author_id = $7) AS identical
      FROM unoa.config_value WHERE request_id = $1
    `, [requestId, key, scopeId, json, reason, effectiveFrom, actor]);
    if (prior.rows[0]) {
      ensure(prior.rows[0].identical, 409, 'Clé de requête déjà utilisée');
      return { key, scopeId, id: prior.rows[0].id };
    }
    ensure(Date.parse(effectiveFrom) > Date.now(), 422, 'Choisir une date d’effet future');
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.config_value (request_id, definition_key, scope_id, value, reason, effective_from, author_id)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7) RETURNING id
    `, [requestId, key, scopeId, json, reason, effectiveFrom, actor]);
    await audit(store, actor, scopeId, 'config.draft_created', correlation, rows[0].id);
    return { key, scopeId, id: rows[0].id };
  });
}

const transitions = {
  submit: { state: 'draft', next: 'review', right: 'write' },
  approve: { state: 'review', next: 'approved', right: 'review' },
  reopen: { state: 'approved', next: 'review', right: 'publish' },
  publish: { state: 'approved', next: 'published', right: 'publish' },
} as const;

export async function transitionValue(
  settings: IamSettings, actor: string, id: string, action: string, input: Input, correlation: string,
) {
  ensure(Object.hasOwn(transitions, action), 404, 'Action inconnue');
  const transition = transitions[action as keyof typeof transitions];
  const scopeId = uuid(input.scopeId);
  const key = keyName(input.key);

  return transaction(settings, 'unoa.config.' + key, async store => {
    const scope = await getScope(store, actor, scopeId);
    ensure(scope?.[transition.right], 403, 'Action non autorisée');
    const { rows } = await store.query<Version>(`
      SELECT * FROM unoa.config_value WHERE id = $1 AND definition_key = $2 AND scope_id = $3 FOR UPDATE
    `, [uuid(id), key, scopeId]);
    const version = rows[0];
    ensure(version, 404, 'Version introuvable');
    ensure(version.state === transition.state, 409, 'La version a changé depuis son affichage');
    if (action === 'approve') ensure(version.author_id !== actor, 403, 'La revue doit être effectuée par une autre personne');
    let baseVersion: number | null = null;
    if (action === 'approve' || action === 'publish') {
      const at = version.effective_from.toISOString();
      ensure(Date.parse(at) > Date.now(), 422, 'La date d’effet est passée. Créer une nouvelle version');
      const def = await definition(store, key);
      baseVersion = (await effective(store, def, scopeId, at)).source?.version ?? null;
      const previewed = input.previewVersion === '' || input.previewVersion === null ? null : Number(input.previewVersion);
      ensure(previewed === baseVersion, 409, 'La valeur de référence a changé. Refaire la prévisualisation');
      if (action === 'publish') {
        ensure(version.reviewed_against === baseVersion, 409, 'La valeur a changé depuis l’approbation. Renvoyer en revue');
      }
    }
    await store.query(`
      UPDATE unoa.config_value SET state = $2,
        approved_by = CASE WHEN $2 = 'approved' THEN $3::uuid WHEN $2 = 'published' THEN approved_by END,
        reviewed_against = CASE WHEN $2 IN ('approved', 'published') THEN $4::integer END,
        published_by = CASE WHEN $2 = 'published' THEN $3::uuid END,
        published_at = CASE WHEN $2 = 'published' THEN now() END
      WHERE id = $1
    `, [id, transition.next, actor, baseVersion]);
    if (action === 'publish') {
      await store.query(`
        INSERT INTO unoa.config_publication_event(version_id, scope_id, actor_id, correlation_id)
        VALUES ($1, $2, $3, $4)
      `, [id, scopeId, actor, correlation]);
    }
    await audit(store, actor, scopeId, 'config.' + action, correlation, id);
    return { key, scopeId, id };
  });
}
