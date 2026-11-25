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
    // One instance at a time applies the rights (the pool holds a single connection).
    await pool.query('SELECT pg_advisory_lock($1)', [7843392887071802n]);
    await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE "${role}" NOLOGIN; END IF; END $$`);
    await pool.query(await script('grant-web.psql'));
    await pool.query(`GRANT "${role}" TO CURRENT_USER WITH INHERIT FALSE, SET TRUE`);
    const { rows } = await pool.query(await script('verify-web.psql'));
    const failed = Object.entries(rows[0]).filter(([, value]) => value === false).map(([name]) => name);
    if (failed.length) throw new Error('Contrôles de droits en échec : ' + failed.join(', '));
    await pool.query('SELECT pg_advisory_unlock($1)', [7843392887071802n]);
    return { applied, checks: Object.keys(rows[0]).length };
  } finally {
    await pool.end();
  }
}

// Development reset (owner's request, ADR-0015): drops every UNOA object, rebuilds
// the empty schema and rights, and installs the single platform administrator.
export async function resetDatabase({ connectionString, role = 'unoa_web', root, admin }) {
  const url = new URL(connectionString);
  url.searchParams.delete('channel_binding');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) url.searchParams.set('sslmode', 'verify-full');
  const pool = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 15_000, max: 1 });
  try {
    await pool.query('SELECT pg_advisory_lock($1)', [7843392887071802n]);
    await pool.query('DROP SCHEMA IF EXISTS unoa CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS unoa_meta CASCADE');
    await pool.query('SELECT pg_advisory_unlock($1)', [7843392887071802n]);
  } finally {
    await pool.end();
  }
  const provisioned = await provisionDatabase({ connectionString, role, root });
  const owner = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 15_000, max: 1 });
  try {
    const { rows: [installed] } = await owner.query('SELECT unoa.install_platform($1, $2, NULL, $3, $4, $5) AS account',
      [admin.login, admin.hash, admin.name, 'plateforme', admin.platform]);
    await owner.query('SELECT unoa.set_development_mode($1, true, gen_random_uuid())', [installed.account]);
    await owner.query('UPDATE unoa.local_credential SET must_change = false WHERE account_id = $1', [installed.account]);
    return { ...provisioned, account: installed.account };
  } finally {
    await owner.end();
  }
}
