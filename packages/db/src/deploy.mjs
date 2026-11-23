import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { migrate } from './migrations.mjs';

// Run by the Vercel build before "next build": brings the database linked by
// the Neon ↔ Vercel integration to the current schema, creates the restricted
// role, applies its rights and verifies them (ADR-0009). Without a database
// URL (local or CI build) it does nothing. Any failed check stops the deployment.
const connectionString = process.env.UNOA_MIGRATION_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
const role = process.env.UNOA_DATABASE_ROLE || 'unoa_web';

if (!connectionString) {
  console.log('Base non liée : migrations ignorées pour ce build.');
} else if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
  console.error('UNOA_DATABASE_ROLE invalide');
  process.exitCode = 1;
} else {
  const url = new URL(connectionString);
  url.searchParams.delete('channel_binding');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) url.searchParams.set('sslmode', 'verify-full');
  const pool = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 15_000, max: 1 });
  // psql scripts of infra/postgres, executed through the driver: \set lines removed,
  // the role variable substituted (validated identifier above).
  const script = async name => (await readFile(new URL(`../../../infra/postgres/${name}`, import.meta.url), 'utf8'))
    .split('\n').filter(line => !line.startsWith('\\')).join('\n')
    .replaceAll(':"web_role"', `"${role}"`).replaceAll(":'web_role'", `'${role}'`);
  try {
    const applied = await migrate(pool);
    console.log(applied.length ? `Migrations appliquées : ${applied.join(', ')}` : 'Base à jour.');
    await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE "${role}" NOLOGIN; END IF; END $$`);
    await pool.query(await script('grant-web.psql'));
    await pool.query(`GRANT "${role}" TO CURRENT_USER WITH INHERIT FALSE, SET TRUE`);
    const { rows } = await pool.query(await script('verify-web.psql'));
    const failed = Object.entries(rows[0]).filter(([name, value]) => value === false && name !== 'migrations').map(([name]) => name);
    if (failed.length) throw new Error('Contrôles de droits en échec : ' + failed.join(', '));
    console.log(`Droits du rôle ${role} appliqués et vérifiés (${Object.keys(rows[0]).length} contrôles).`);
  } catch (error) {
    console.error(`Déploiement de la base interrompu : ${error.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
