import 'server-only';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { provisionDatabase } from '@unoa/db/provision';

// Integration mode (ADR-0009): Vercel exposes the owner URL only at run time,
// so the first connection of an instance brings the linked database to the
// current schema and rights (advisory lock, idempotent). Until it succeeds no
// connection is handed out; a failure is retried after one minute.

export interface ProvisionState { status: 'pending' | 'ok' | 'failed'; at: string; applied?: number; checks?: number; code?: string; failedChecks?: string[] }

let running: Promise<void> | null = null;
let failedAt = 0;
export let provisionState: ProvisionState = { status: 'pending', at: new Date().toISOString() };

function root() {
  const found = [join(process.cwd(), '../..'), process.cwd(), join(process.cwd(), '..')]
    .find(candidate => existsSync(join(candidate, 'packages/db/migrations')) && existsSync(join(candidate, 'infra/postgres/grant-web.psql')));
  if (!found) throw Object.assign(new Error('Migration files not deployed'), { code: 'UNOA_FILES' });
  return found;
}

export function ensureProvisioned(connectionString: string, role: string) {
  if (provisionState.status === 'ok') return Promise.resolve();
  if (!running && Date.now() - failedAt > 60_000) {
    running = provisionDatabase({ connectionString, role, root: root() }).then(result => {
      provisionState = { status: 'ok', at: new Date().toISOString(), applied: result.applied.length, checks: result.checks };
    }, error => {
      failedAt = Date.now();
      const code = typeof error?.code === 'string' && /^[A-Z0-9_]{3,20}$/.test(error.code) ? error.code : 'unknown';
      const message = String(error?.message ?? '');
      const failedChecks = message.startsWith('Contrôles de droits en échec : ') ? message.slice(31).split(', ').filter(name => /^[a-z_]+$/.test(name)) : undefined;
      provisionState = { status: 'failed', at: new Date().toISOString(), code, failedChecks };
      console.error('unoa-provision', code, String(error?.message ?? '').replace(/postgres(ql)?:\/\/\S+/g, '[adresse]').slice(0, 200));
    }).finally(() => { running = null; });
  }
  return (running ?? Promise.resolve()).then(() => {
    if (provisionState.status !== 'ok') throw Object.assign(new Error('Database provisioning failed'), { code: 'UNOA_PROVISION' });
  });
}
