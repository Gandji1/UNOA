import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';

export type Queryable = Pool | PoolClient;

// Every studio mutation runs in one transaction, serialized per business key,
// and writes its audit event inside the same transaction.
export async function transaction<T>(settings: IamSettings, lock: string, change: (store: PoolClient) => Promise<T>) {
  const store = await database(settings).connect();
  try {
    await store.query('BEGIN');
    await store.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lock]);
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

export async function audit(
  store: Queryable, actor: string, scope: string | null, action: string, correlation: string, resource?: string | null,
) {
  await store.query(`
    INSERT INTO unoa.audit_event(actor_id, scope_id, action, correlation_id, resource_id, outcome)
    VALUES ($1, $2, $3, $4, $5, 'allowed')
  `, [actor, scope, action, correlation, resource ?? null]);
}

export async function auditDenial(settings: IamSettings, actor: string, action: string, correlation: string) {
  await database(settings).query(`
    INSERT INTO unoa.audit_event(actor_id, action, correlation_id, outcome) VALUES ($1, $2, $3, 'denied')
  `, [actor, action, correlation]);
}


