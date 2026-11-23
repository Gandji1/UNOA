import { fileURLToPath } from 'node:url';
import { provisionDatabase } from './provision.mjs';

// Command line: provisions the database of UNOA_MIGRATION_DATABASE_URL (or the
// URL injected by the Neon ↔ Vercel integration) — migrations, web role, rights, checks.
const connectionString = process.env.UNOA_MIGRATION_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
if (!connectionString) {
  console.log('Base non liée : rien à déployer.');
} else {
  try {
    const { applied, checks } = await provisionDatabase({
      connectionString, role: process.env.UNOA_DATABASE_ROLE || 'unoa_web', root: fileURLToPath(new URL('../../../', import.meta.url)),
    });
    console.log(`${applied.length ? 'Migrations appliquées : ' + applied.join(', ') : 'Base à jour'} ; ${checks} contrôles de droits vérifiés.`);
  } catch (error) {
    console.error(`Déploiement de la base interrompu : ${error.message}`);
    process.exitCode = 1;
  }
}
