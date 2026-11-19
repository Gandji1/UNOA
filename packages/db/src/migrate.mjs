import pg from 'pg';
import { migrate } from './migrations.mjs';

const connectionString = process.env.UNOA_MIGRATION_DATABASE_URL;
if (!connectionString) {
  throw new Error('Définir UNOA_MIGRATION_DATABASE_URL avant de migrer.');
}

const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 10_000, max: 1 });
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `Migrations appliquées : ${applied.join(', ')}` : 'Base à jour.');
} catch (error) {
  console.error(`Migration interrompue : ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
