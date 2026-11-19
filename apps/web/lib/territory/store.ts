import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, requireConfig, utcTime, uuid, type Input } from '@/lib/config/validation';
import { attachmentKind, attributes, language, typeCode, typeInput, type Nature } from './validation';

type Queryable = Pool | PoolClient;

export interface TerritoryScope {
  id: string;
  label: string;
  type_code: string;
  type_label: string;
  nature: Nature;
  parent_id: string | null;
  parent_label: string | null;
  root: boolean;
  time_zone: string | null;
  currency: string | null;
  locale: string | null;
  legal_name: string | null;
  contact: string | null;
  present_from: Date;
  present_until: Date | null;
  read: boolean;
  write: boolean;
  define: boolean;
}

export interface ScopeTypeRow {
  code: string;
  label: string;
  nature: Nature;
  parents: string[];
}

export interface LabelRow {
  language: string;
  label: string;
  updated_at: Date;
}

export interface AttachmentRow {
  id: string;
  kind: 'implantation' | 'regulatory';
  territory_id: string;
  territory_label: string;
  reason: string;
  effective_from: Date;
  effective_until: Date | null;
  readable: boolean;
}

const scopeFields = `
  scope.id, scope.label, scope.type_code, scope.parent_id, scope.time_zone, scope.currency,
  scope.locale, scope.legal_name, scope.contact, scope.present_from, scope.present_until,
  scope.parent_id IS NULL AS root, kind.label AS type_label, kind.nature,
  parent.label AS parent_label,
  unoa.has_scope_permission($1, 'territory.read', scope.id) AS read,
  unoa.has_scope_permission($1, 'territory.write', scope.id) AS write,
  unoa.has_scope_permission($1, 'territory.define', scope.id) AS define
  FROM unoa.scope AS scope
  JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
  LEFT JOIN unoa.scope AS parent ON parent.id = scope.parent_id
`;

export async function readableTerritories(settings: IamSettings, actor: string, after?: string) {
  const { rows } = await database(settings).query<TerritoryScope>(`
    SELECT ${scopeFields}
    WHERE ($2::uuid IS NULL OR scope.id > $2)
      AND unoa.has_scope_permission($1, 'territory.read', scope.id)
    ORDER BY scope.id LIMIT 51
  `, [actor, after || null]);
  return rows;
}

async function getTerritory(store: Queryable, actor: string, scopeId: string) {
  const { rows } = await store.query<TerritoryScope>(`
    SELECT ${scopeFields}
    WHERE scope.id = $2 AND unoa.has_scope_permission($1, 'territory.read', scope.id)
  `, [actor, scopeId]);
  return rows[0] ?? null;
}

export async function scopeTypeCatalogue(settings: IamSettings) {
  const { rows } = await database(settings).query<ScopeTypeRow>(`
    SELECT kind.code, kind.label, kind.nature,
           coalesce(array_agg(rule.parent_type_code ORDER BY rule.parent_type_code)
             FILTER (WHERE rule.parent_type_code IS NOT NULL), '{}') AS parents
    FROM unoa.scope_type AS kind
    LEFT JOIN unoa.scope_type_parent AS rule ON rule.type_code = kind.code
    GROUP BY kind.code, kind.label, kind.nature
    ORDER BY kind.label, kind.code
  `);
  return rows;
}

export async function territoryDetails(settings: IamSettings, actor: string, scopeId: string, after?: string) {
  const store = database(settings);
  const scope = await getTerritory(store, actor, scopeId);
  requireConfig(scope, 403, 'Portée inaccessible');
  const [children, labels, attachments, hosted] = await Promise.all([
    store.query<TerritoryScope>(`
      SELECT ${scopeFields}
      WHERE scope.parent_id = $2 AND ($3::uuid IS NULL OR scope.id > $3)
        AND unoa.has_scope_permission($1, 'territory.read', scope.id)
      ORDER BY scope.id LIMIT 25
    `, [actor, scopeId, after || null]),
    store.query<LabelRow>(
      'SELECT language, label, updated_at FROM unoa.scope_label WHERE scope_id = $1 ORDER BY language', [scopeId],
    ),
    store.query<AttachmentRow>(`
      SELECT attachment.id, attachment.kind, attachment.territory_id, attachment.reason,
             attachment.effective_from, attachment.effective_until, territory.label AS territory_label,
             unoa.has_scope_permission($1, 'territory.read', territory.id) AS readable
      FROM unoa.scope_attachment AS attachment
      JOIN unoa.scope AS territory ON territory.id = attachment.territory_id
      WHERE attachment.scope_id = $2
      ORDER BY attachment.kind, attachment.effective_from DESC LIMIT 50
    `, [actor, scopeId]),
    store.query<AttachmentRow>(`
      SELECT attachment.id, attachment.kind, attachment.scope_id AS territory_id, attachment.reason,
             attachment.effective_from, attachment.effective_until, establishment.label AS territory_label,
             unoa.has_scope_permission($1, 'territory.read', establishment.id) AS readable
      FROM unoa.scope_attachment AS attachment
      JOIN unoa.scope AS establishment ON establishment.id = attachment.scope_id
      WHERE attachment.territory_id = $2
      ORDER BY attachment.effective_from DESC LIMIT 50
    `, [actor, scopeId]),
  ]);
  return {
    scope,
    children: children.rows.slice(0, 24),
    nextChild: children.rows.length > 24 ? children.rows[23].id : null,
    labels: labels.rows,
    attachments: attachments.rows.filter(row => row.readable),
    hosted: hosted.rows.filter(row => row.readable),
  };
}

export async function auditTerritoryDenial(settings: IamSettings, actor: string, correlation: string) {
  await database(settings).query(`
    INSERT INTO unoa.audit_event(actor_id, action, correlation_id, outcome)
    VALUES ($1, 'territory.access', $2, 'denied')
  `, [actor, correlation]);
}

async function audit(store: Queryable, actor: string, scope: string, action: string, correlation: string, resource?: string) {
  await store.query(`
    INSERT INTO unoa.audit_event(actor_id, scope_id, action, correlation_id, resource_id, outcome)
    VALUES ($1, $2, $3, $4, $5, 'allowed')
  `, [actor, scope, action, correlation, resource ?? null]);
}

async function transactional<T>(settings: IamSettings, key: string, change: (store: PoolClient) => Promise<T>) {
  const store = await database(settings).connect();
  try {
    await store.query('BEGIN');
    // Serialize decisions touching the same branch of the territorial tree.
    await store.query("SELECT pg_advisory_xact_lock(hashtextextended('unoa.territory.' || $1, 0))", [key]);
    const result = await change(store);
    await store.query('COMMIT');
    return result;
  } catch (error) {
    await store.query('ROLLBACK');
    throw error;
  } finally {
    store.release();
  }
}

export async function createScopeType(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const scopeId = uuid(input.scopeId);
  const item = typeInput(input);
  return transactional(settings, 'types', async store => {
    const scope = await getTerritory(store, actor, scopeId);
    requireConfig(scope?.root && scope.define, 403, 'Définition de type non autorisée');
    const created = await store.query(`
      INSERT INTO unoa.scope_type(code, label, nature) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING
    `, [item.code, item.label, item.nature]);
    requireConfig(created.rowCount === 1, 409, 'Ce code de type existe déjà');
    for (const parent of item.parentTypes) {
      await store.query(
        'INSERT INTO unoa.scope_type_parent(type_code, parent_type_code) VALUES ($1, $2)', [item.code, parent],
      );
    }
    await audit(store, actor, scopeId, 'territory.type_created', correlation);
    return { scopeId, code: item.code };
  });
}

export async function createTerritory(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const parentId = uuid(input.parentId);
  const kind = typeCode(input.typeCode);
  const item = attributes(input);
  const presentFrom = utcTime(input.presentFrom);
  return transactional(settings, parentId, async store => {
    const parent = await getTerritory(store, actor, parentId);
    requireConfig(parent?.write, 403, 'Création de portée non autorisée');
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.scope(type_code, parent_id, label, time_zone, currency, locale,
                             legal_name, contact, present_from, present_until)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id
    `, [kind, parentId, item.label, item.timeZone, item.currency, item.locale,
      item.legalName, item.contact, presentFrom, item.presentUntil]);
    await audit(store, actor, parentId, 'territory.created', correlation, rows[0].id);
    return { scopeId: rows[0].id, parentId };
  });
}

export async function updateTerritory(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const scopeId = uuid(id);
  const item = attributes(input);
  return transactional(settings, scopeId, async store => {
    const scope = await getTerritory(store, actor, scopeId);
    requireConfig(scope?.write, 403, 'Modification non autorisée');
    await store.query(`
      UPDATE unoa.scope SET label = $2, time_zone = $3, currency = $4, locale = $5,
        legal_name = $6, contact = $7, present_until = $8 WHERE id = $1
    `, [scopeId, item.label, item.timeZone, item.currency, item.locale,
      item.legalName, item.contact, item.presentUntil]);
    await audit(store, actor, scopeId, 'territory.updated', correlation, scopeId);
    return { scopeId };
  });
}

export async function setTerritoryLabel(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const scopeId = uuid(id);
  const tag = language(input.language);
  const label = boundedText(input.label, 160, 'Désignation');
  return transactional(settings, scopeId, async store => {
    const scope = await getTerritory(store, actor, scopeId);
    requireConfig(scope?.write, 403, 'Traduction non autorisée');
    await store.query(`
      INSERT INTO unoa.scope_label(scope_id, language, label) VALUES ($1, $2, $3)
      ON CONFLICT (scope_id, language) DO UPDATE SET label = excluded.label, updated_at = now()
    `, [scopeId, tag, label]);
    await audit(store, actor, scopeId, 'territory.label_set', correlation, scopeId);
    return { scopeId };
  });
}

export async function attachTerritory(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const scopeId = uuid(id);
  const territoryId = uuid(input.territoryId);
  const kind = attachmentKind(input.kind);
  const reason = boundedText(input.reason, 500, 'Justification');
  const effectiveFrom = utcTime(input.effectiveFrom);
  const effectiveUntil = input.effectiveUntil ? utcTime(input.effectiveUntil) : null;
  return transactional(settings, scopeId, async store => {
    const scope = await getTerritory(store, actor, scopeId);
    requireConfig(scope?.write, 403, 'Rattachement non autorisé');
    // The target must also be visible, so no establishment claims an unseen territory.
    requireConfig(await getTerritory(store, actor, territoryId), 403, 'Territoire de rattachement inaccessible');
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.scope_attachment(scope_id, territory_id, kind, reason, effective_from, effective_until)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
    `, [scopeId, territoryId, kind, reason, effectiveFrom, effectiveUntil]);
    await audit(store, actor, scopeId, 'territory.attached', correlation, rows[0].id);
    return { scopeId, id: rows[0].id };
  });
}

export async function closeAttachment(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const scopeId = uuid(input.scopeId);
  const attachmentId = uuid(id);
  const effectiveUntil = utcTime(input.effectiveUntil);
  return transactional(settings, scopeId, async store => {
    const scope = await getTerritory(store, actor, scopeId);
    requireConfig(scope?.write, 403, 'Clôture non autorisée');
    const closed = await store.query(`
      UPDATE unoa.scope_attachment SET effective_until = $3
      WHERE id = $1 AND scope_id = $2 AND effective_until IS NULL
    `, [attachmentId, scopeId, effectiveUntil]);
    requireConfig(closed.rowCount === 1, 409, 'Ce rattachement est déjà clos ou introuvable');
    await audit(store, actor, scopeId, 'territory.detached', correlation, attachmentId);
    return { scopeId, id: attachmentId };
  });
}
