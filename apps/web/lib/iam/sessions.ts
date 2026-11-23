import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { Client, Pool } from 'pg';
import { sessionDurationSeconds, type IamSettings } from './settings';

let pool: Pool | undefined;

// Owner URL from the hosting integration (ADR-0009): the pool hands out a
// connection only after it switched to the restricted role and checked it;
// any failure closes the connection (fail closed).
function restrictedClient(role: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error('Invalid database role');
  return class RestrictedClient extends Client {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async connect(callback?: (error: Error | undefined) => void): Promise<any> {
      try {
        await super.connect();
        await this.query(`SET ROLE ${role}`);
        const { rows } = await this.query<{ current_user: string }>('SELECT current_user');
        if (rows[0]?.current_user !== role) throw new Error('Database role switch failed');
      } catch (error) {
        await this.end().catch(() => undefined);
        if (callback) return callback(error as Error);
        throw error;
      }
      if (callback) return callback(undefined);
      return this;
    }
  } as unknown as typeof Client;
}

export function database(settings: IamSettings) {
  if (!pool) {
    pool = new Pool({
      connectionString: settings.databaseUrl,
      max: 2,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      idleTimeoutMillis: 5000,
      allowExitOnIdle: true,
      ...(settings.databaseRole ? { Client: restrictedClient(settings.databaseRole) } : {}),
    });
    pool.on('error', () => console.error('unoa-iam-database-idle-error'));

  }
  return pool;
}

function tokenHash(token?: string) {
  return token && /^[\w-]{43}$/.test(token) ? createHash('sha256').update(token).digest() : null;
}

export async function openSession(settings: IamSettings, identity: { issuer: string; subject: string }) {
  const token = randomBytes(32).toString('base64url');
  const result = await database(settings).query(`
    INSERT INTO unoa.login_session(token_hash, account_id, account_epoch, expires_at)
    SELECT $1, account.id, account.session_epoch, now() + make_interval(secs => $4::int)
    FROM unoa.login_identity AS identity
    JOIN unoa.account AS account ON account.id = identity.account_id
    WHERE identity.issuer = $2 AND identity.subject = $3 AND account.disabled_at IS NULL
  `, [tokenHash(token), identity.issuer, identity.subject, sessionDurationSeconds]);
  return result.rowCount === 1 ? token : null;
}

const activeSession = `
    FROM unoa.login_session AS session
    JOIN unoa.account AS account ON account.id = session.account_id
    WHERE session.token_hash = $1
      AND session.expires_at > statement_timestamp()
      AND session.revoked_at IS NULL
      AND account.disabled_at IS NULL
      AND session.account_epoch = account.session_epoch
`;

export async function sessionAccount(settings: IamSettings, token?: string) {
  const hash = tokenHash(token);
  if (!hash) return null;
  const { rows } = await database(settings).query<{ account_id: string }>(
    `SELECT session.account_id ${activeSession}`, [hash],
  );
  return rows[0]?.account_id ?? null;
}

export async function revokeSession(settings: IamSettings, token?: string) {
  const hash = tokenHash(token);
  if (hash) await database(settings).query(`
    UPDATE unoa.login_session SET revoked_at = now()
    WHERE token_hash = $1 AND revoked_at IS NULL
  `, [hash]);
}

export async function checkPermission(
  settings: IamSettings, token: string | undefined, permission: string, scopeId: string, correlationId: string,
) {
  const hash = tokenHash(token);
  if (!hash) return 'anonymous';
  const { rows } = await database(settings).query<{ account_id: string; allowed: boolean }>(`
    SELECT session.account_id, unoa.has_scope_permission(session.account_id, $2, $3) AS allowed
    ${activeSession}
  `, [hash, permission, scopeId]);
  const decision = rows[0];
  if (!decision) return 'anonymous';
  if (decision.allowed) return 'allowed';
  await database(settings).query(`
    INSERT INTO unoa.audit_event(actor_id, action, correlation_id, resource_id, outcome)
    VALUES ($1, 'access.check', $2, $3, 'denied')
  `, [decision.account_id, correlationId, scopeId]);
  return 'denied';
}
