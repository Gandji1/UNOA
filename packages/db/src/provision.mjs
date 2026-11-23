import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { migrate } from './migrations.mjs';

// Brings a database to the current schema with the owner connection, creates
// the restricted web role, applies its rights and checks them (ADR-0009).
// `root` is the repository root holding packages/db/migrations and infra/postgres.
export async function provisionDatabase({ connectionString, role = 'unoa_web', root }) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error('Rôle de base invalide');
  const url = new URL(connectionString);
  url.searchParams.delete('channel_binding');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) url.searchParams.set('sslmode', 'verify-full');
  const script = async name => (await readFile(join(root, 'infra/postgres', name), 'utf8'))
    .split('\n').filter(line => !line.startsWith('\\')).join('\n')
    .replaceAll(':"web_role"', `"${role}"`).replaceAll(":'web_role'", `'${role}'`);
  const pool = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 15_000, max: 1 });
  try {
    const applied = await migrate(pool, join(root, 'packages/db/migrations'));
    await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE "${role}" NOLOGIN; END IF; END $$`);
    await pool.query(await script('grant-web.psql'));
    await pool.query(`GRANT "${role}" TO CURRENT_USER WITH INHERIT FALSE, SET TRUE`);
    const { rows } = await pool.query(await script('verify-web.psql'));
    const failed = Object.entries(rows[0]).filter(([, value]) => value === false).map(([name]) => name);
    if (failed.length) throw new Error('Contrôles de droits en échec : ' + failed.join(', '));
    return { applied, checks: Object.keys(rows[0]).length };
  } finally {
    await pool.end();
  }
}
