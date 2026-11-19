import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
const migrationLock = 7843392887071801n;

export async function migrate(pool, migrationDirectory = directory) {
  const files = (await readdir(migrationDirectory))
    .filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  if (!files.length || new Set(files.map(name => name.slice(0, 4))).size !== files.length) {
    throw new Error('Les numéros de migration doivent être uniques et le dossier ne peut pas être vide.');
  }
  const migrations = await Promise.all(files.map(async name => {
    const sql = await readFile(join(migrationDirectory, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    return { name, sql, checksum };
  }));

  const client = await pool.connect();
  let connectionError;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query("SET LOCAL search_path = pg_catalog, pg_temp");
    await client.query('SELECT pg_advisory_xact_lock($1)', [migrationLock]);
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS unoa_meta;
      REVOKE ALL ON SCHEMA unoa_meta FROM PUBLIC;
      CREATE TABLE IF NOT EXISTS unoa_meta.migration (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    const { rows } = await client.query('SELECT name, checksum FROM unoa_meta.migration ORDER BY name');
    for (const [index, row] of rows.entries()) {
      const migration = migrations[index];
      if (!migration || migration.name !== row.name || migration.checksum !== row.checksum) {
        throw new Error(`Historique incohérent pour ${row.name}. Restaurer les fichiers de migration d’origine.`);
      }
    }
    const pending = migrations.slice(rows.length);
    for (const { name, checksum, sql } of pending) {
      await client.query(sql);
      await client.query('INSERT INTO unoa_meta.migration(name, checksum) VALUES ($1, $2)', [name, checksum]);
    }
    await client.query('COMMIT');
    return pending.map(({ name }) => name);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      connectionError = rollbackError;
    }
    throw error;
  } finally {
    client.release(connectionError);
  }
}
