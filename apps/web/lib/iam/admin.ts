import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { IamSettings } from './settings';
import { database } from './sessions';
import { resetPassword, setDevelopmentMode } from './local';
import { boundedText, choice, ensure, flag, optional, Problem, text, technicalCode, utcTime, uuid, type Input } from '@/lib/shared/validation';

// Administration of accounts and access (IAM). Every write goes through a
// database function that checks the actor's rights again (no self-grant,
// no escalation, delegation bounded, audit written in the same statement).

export const tokenHashOf = (token: string) => /^[\w-]{43}$/.test(token) ? createHash('sha256').update(token).digest() : null;

const emailFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const email = (value: unknown) => {
  const result = boundedText(value, 254, 'Courriel').toLowerCase();
  ensure(emailFormat.test(result), 400, 'Courriel invalide');
  return result;
};

export async function adminContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string; nature: string }>(`
    SELECT scope.id, scope.label, kind.nature FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE unoa.has_scope_permission($1, 'iam.read', scope.id)
    ORDER BY scope.parent_id NULLS FIRST, kind.nature, scope.label LIMIT 200
  `, [actor]);
  return rows;
}

async function rights(settings: IamSettings, actor: string, scopeId: string) {
  const { rows } = await database(settings).query<Record<'read' | 'manage' | 'assign' | 'accounts' | 'audit', boolean>>(`
    SELECT unoa.has_scope_permission($1, 'iam.read', $2) AS read, unoa.has_scope_permission($1, 'iam.manage', $2) AS manage,
           unoa.has_scope_permission($1, 'iam.assign', $2) AS assign, unoa.has_scope_permission($1, 'iam.accounts', $2) AS accounts,
           unoa.has_scope_permission($1, 'audit.read', $2) AS audit
  `, [actor, scopeId]);
  return rows[0];
}

export async function accessOverview(settings: IamSettings, actor: string, scope: string, search?: string) {
  const scopeId = uuid(scope);
  const granted = await rights(settings, actor, scopeId);
  ensure(granted?.read || granted?.audit, 403, 'Périmètre inaccessible');
  const store = database(settings);
  const [label, accounts, invitations, roles, root] = await Promise.all([
    store.query<{ label: string }>('SELECT label FROM unoa.scope WHERE id = $1', [scopeId]),
    granted.read ? store.query<{ id: string; display_name: string | null; email: string | null; origin: string; created_at: Date; disabled_at: Date | null; grants: number; sessions: number }>(
      'SELECT * FROM unoa.iam_accounts($1, $2, $3)', [actor, scopeId, search?.trim() ? search.trim().slice(0, 100) : null]) : { rows: [] },
    granted.read ? store.query<{ id: string; display_name: string; email: string | null; role_code: string; scope_label: string; created_at: Date; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null }>(`
      SELECT invitation.id, invitation.display_name, invitation.email, invitation.role_code, scope.label AS scope_label,
             invitation.created_at, invitation.expires_at, invitation.accepted_at, invitation.revoked_at
      FROM unoa.invitation JOIN unoa.scope ON scope.id = invitation.scope_id
      WHERE unoa.scope_within(invitation.scope_id, $1) ORDER BY invitation.created_at DESC LIMIT 100
    `, [scopeId]) : { rows: [] },
    store.query<{ code: string; label: string | null; system: boolean; assignable: boolean; level: string; description: string | null }>(`
      SELECT code, label, system, level, description,
        unoa.can_grant($1, code, $2) AND coalesce((SELECT CASE level WHEN 'platform' THEN $2 = (SELECT id FROM unoa.scope WHERE parent_id IS NULL)
          WHEN 'territory' THEN kind.nature IN ('territory', 'jurisdiction') WHEN 'institution' THEN kind.nature IN ('institution', 'centre', 'academic_unit')
          ELSE kind.nature = 'academic_unit' END FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code WHERE scope.id = $2), false) AS assignable
      FROM unoa.access_role WHERE archived_at IS NULL ORDER BY ordinal, coalesce(label, code)
    `, [actor, scopeId]),
    store.query<{ id: string }>('SELECT id FROM unoa.scope WHERE parent_id IS NULL'),
  ]);
  return {
    scope: { id: scopeId, label: label.rows[0]?.label ?? '', root: root.rows[0]?.id === scopeId }, rights: granted,
    accounts: accounts.rows, invitations: invitations.rows, roles: roles.rows,
  };
}

export async function roleCatalogue(settings: IamSettings, actor: string) {
  const store = database(settings);
  const [permissions, roles, root] = await Promise.all([
    store.query<{ code: string; module: string | null; label: string | null; sensitive: boolean }>(
      'SELECT code, module, label, sensitive FROM unoa.permission ORDER BY module NULLS LAST, code'),
    store.query<{ code: string; label: string | null; description: string | null; system: boolean; archived_at: Date | null; permissions: string[]; level: string }>(`
      SELECT role.code, role.label, role.description, role.system, role.archived_at, role.level,
             coalesce(array_agg(item.permission_code ORDER BY item.permission_code) FILTER (WHERE item.permission_code IS NOT NULL), '{}') AS permissions
      FROM unoa.access_role AS role LEFT JOIN unoa.role_permission AS item ON item.role_code = role.code
      GROUP BY role.code ORDER BY role.archived_at NULLS FIRST, role.ordinal, coalesce(role.label, role.code)
    `),
    store.query<{ manage: boolean; id: string }>(`SELECT id, unoa.has_scope_permission($1, 'iam.manage', id) AS manage FROM unoa.scope WHERE parent_id IS NULL`, [actor]),
  ]);
  ensure(root.rows[0] && (await rights(settings, actor, root.rows[0].id))?.read, 403, 'Catalogue des rôles réservé à l’administration de la plateforme');
  return { permissions: permissions.rows, roles: roles.rows, manage: root.rows[0].manage, rootId: root.rows[0].id };
}

export async function accountDetails(settings: IamSettings, actor: string, id: string) {
  const accountId = uuid(id);
  const store = database(settings);
  const { rows: allowed } = await store.query<{ read: boolean; accounts: boolean }>(
    `SELECT $1::uuid = $2::uuid OR unoa.covers_account($1, 'iam.read', $2) OR EXISTS (
       SELECT 1 FROM unoa.iam_account($1, $2)) AS read, unoa.covers_account($1, 'iam.accounts', $2) AS accounts`, [actor, accountId]);
  ensure(allowed[0]?.read, 403, 'Compte inaccessible');
  const [profile, grants, sessions] = await Promise.all([
    store.query<{ id: string; display_name: string | null; email: string | null; origin: string; created_at: Date; disabled_at: Date | null; disabled_reason: string | null }>(
      'SELECT id, display_name, email, origin, created_at, disabled_at, disabled_reason FROM unoa.account WHERE id = $1', [accountId]),
    store.query<{ grant_id: string; role_code: string; role_label: string | null; scope_id: string; scope_label: string; include_descendants: boolean;
      effective_from: Date; effective_until: Date | null; revoked_at: Date | null; reason: string | null; revoke_reason: string | null;
      delegated_from: string | null; granted_by_name: string | null }>('SELECT * FROM unoa.iam_account($1, $2)', [actor, accountId]),
    store.query<{ started_at: Date; expires_at: Date; revoked_at: Date | null }>('SELECT * FROM unoa.iam_sessions($1, $2)', [actor, accountId]),
  ]);
  ensure(profile.rows[0], 404, 'Compte introuvable');
  return { account: profile.rows[0], grants: grants.rows, sessions: sessions.rows, self: actor === accountId, manageable: !!allowed[0].accounts };
}

export async function auditTrail(settings: IamSettings, actor: string, scope: string, prefix?: string, before?: string) {
  const scopeId = uuid(scope);
  const filter = prefix && /^[a-z][a-z0-9_.]{0,40}$/.test(prefix) ? prefix : null;
  const until = before ? utcTime(before) : null;
  ensure((await rights(settings, actor, scopeId))?.audit, 403, 'Journal d’audit inaccessible');
  const { rows } = await database(settings).query<{ id: string; occurred_at: Date; action: string; outcome: string; actor_id: string | null;
    actor_name: string | null; scope_label: string | null; resource_id: string | null; correlation_id: string }>(
    'SELECT * FROM unoa.audit_trail($1, $2, $3, $4)', [actor, scopeId, filter, until]);
  return { events: rows };
}

export async function invitationPreview(settings: IamSettings, token: string) {
  const hash = tokenHashOf(token);
  if (!hash) return null;
  const { rows } = await database(settings).query<{ display_name: string; role_label: string; scope_label: string; expires_at: Date; state: string }>(
    'SELECT * FROM unoa.invitation_preview($1)', [hash]);
  return rows[0] ?? null;
}

const permissionList = (value: unknown) => {
  const items = (Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : []).map(String).filter(Boolean);
  ensure(items.length > 0 && items.length <= 200 && items.every(item => /^[a-z][a-z0-9_.]{0,95}$/.test(item)), 400, 'Permissions invalides');
  return [...new Set(items)];
};
const until = (value: unknown) => optional(value, utcTime);

// One entry point for every administrative write; the function checks rights.
export async function accessAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  const store = database(settings);
  const call = (sql: string, values: unknown[]) => store.query(sql, values).catch(error => {
    if (error?.code === 'P0002') throw new Problem(404, 'Élément introuvable');
    throw error;
  });
  switch (action) {
    case 'roles': {
      const code = technicalCode(input.code, 'Code du rôle');
      ensure(code !== 'platform_admin', 409, 'Rôle réservé');
      await call('SELECT unoa.compose_role($1, $2, $3, $4, $5, $6)', [actor, code, boundedText(input.label, 120, 'Libellé'),
        optional(input.description, text(1000, 'Description')), permissionList(input.permissions), correlation]);
      await call('SELECT unoa.set_role_level($1, $2, $3, $4)', [actor, code,
        choice(input.level ?? 'institution', ['platform', 'territory', 'institution', 'unit'] as const, 'Niveau'), correlation]);
      return { role: code };
    }
    case 'archive-role':
      await call('SELECT unoa.archive_role($1, $2, $3)', [actor, technicalCode(input.code, 'Code du rôle'), correlation]);
      return {};
    case 'grants': {
      const scopeId = uuid(input.scopeId);
      const { rows } = await call('SELECT unoa.grant_role($1, $2, $3, $4, $5, $6, $7, $8) AS id', [actor, uuid(input.accountId),
        technicalCode(input.role, 'Rôle'), scopeId, flag(input.includeDescendants), until(input.effectiveUntil),
        boundedText(input.reason, 500, 'Justification'), correlation]);
      return { id: rows[0].id, scopeId, accountId: String(input.accountId) };
    }
    case 'revoke':
      await call('SELECT unoa.revoke_grant($1, $2, $3, $4)', [actor, uuid(input.grantId), boundedText(input.reason, 500, 'Justification'), correlation]);
      return { accountId: String(input.accountId ?? '') };
    case 'delegate': {
      const { rows } = await call('SELECT unoa.delegate_grant($1, $2, $3, $4, $5, $6) AS id', [actor, uuid(input.grantId), uuid(input.accountId),
        utcTime(input.effectiveUntil), boundedText(input.reason, 500, 'Justification'), correlation]);
      return { id: rows[0].id, accountId: actor };
    }
    case 'invitations': {
      const scopeId = uuid(input.scopeId);
      const token = randomBytes(32).toString('base64url');
      const days = Number(input.validDays ?? 7);
      ensure(Number.isInteger(days) && days >= 1 && days <= 30, 400, 'Validité de 1 à 30 jours');
      const { rows } = await call('SELECT unoa.invite_account($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) AS id', [actor, tokenHashOf(token),
        boundedText(input.displayName, 200, 'Nom'), optional(input.email, email), technicalCode(input.role, 'Rôle'), scopeId,
        flag(input.includeDescendants), until(input.effectiveUntil), boundedText(input.reason, 500, 'Justification'), days, correlation]);
      // The link is shown once to the inviting administrator, who sends it.
      return { id: rows[0].id, scopeId, link: new URL('/invitation/' + token, settings.origin).href };
    }
    case 'revoke-invitation':
      await call('SELECT unoa.revoke_invitation($1, $2, $3)', [actor, uuid(input.invitationId), correlation]);
      return { scopeId: String(input.scopeId ?? '') };
    case 'disable':
    case 'enable':
      await call('SELECT unoa.set_account_state($1, $2, $3, $4, $5)', [actor, uuid(input.accountId), action === 'disable',
        action === 'disable' ? boundedText(input.reason, 500, 'Justification') : null, correlation]);
      return { accountId: String(input.accountId) };
    case 'sessions': {
      const { rows } = await call('SELECT unoa.revoke_account_sessions($1, $2, $3) AS total', [actor, uuid(input.accountId), correlation]);
      return { accountId: String(input.accountId), revoked: rows[0].total };
    }
    case 'reset-password':
      return resetPassword(settings, actor, uuid(input.accountId), input.password, correlation);
    case 'development-mode':
      return setDevelopmentMode(settings, actor, flag(input.enabled), correlation);
    case 'profile': {
      await store.query('UPDATE unoa.account SET display_name = $2, email = $3 WHERE id = $1', [actor,
        boundedText(input.displayName, 200, 'Nom'), optional(input.email, email)]);
      await store.query(`INSERT INTO unoa.audit_event(actor_id, action, correlation_id, resource_id, outcome)
        VALUES ($1, 'iam.profile_changed', $2, $1, 'allowed')`, [actor, correlation]);
      return { accountId: actor };
    }
    default:
      throw new Problem(404, 'Opération inconnue');
  }
}

// Sign-in: an invitation first, then open registration on the current site.
export async function provisionIdentity(settings: IamSettings, identity: { issuer: string; subject: string; name: string | null; email: string | null },
  invitation: string | undefined, siteId: string | null) {
  const store = database(settings);
  const hash = invitation ? tokenHashOf(invitation) : null;
  if (hash) await store.query('SELECT unoa.accept_invitation($1, $2, $3)', [hash, identity.issuer, identity.subject]);
  if (siteId) {
    const { rows } = await store.query<{ account: string | null }>('SELECT unoa.register_account($1, $2, $3) AS account', [siteId, identity.issuer, identity.subject]);
    const account = rows[0]?.account;
    if (account && (identity.name || identity.email)) {
      await store.query('UPDATE unoa.account SET display_name = coalesce(display_name, $2), email = coalesce(email, $3) WHERE id = $1',
        [account, identity.name, identity.email && emailFormat.test(identity.email) ? identity.email.toLowerCase() : null]);
    }
  }
}
