import { parseArgs } from 'node:util';
import pg from 'pg';

// First platform administrator. Run once by the database owner, after the
// migrations. The identity is the issuer and subject of the institutional
// OIDC provider; nothing here creates academic content.
//   node src/bootstrap.mjs --issuer https://idp.example --subject 123 --name "Nom" [--email x@y] [--platform-label UNOA]
//   add --sql to print the statement for a console (Neon SQL editor) instead of running it.
const { values } = parseArgs({
  options: {
    issuer: { type: 'string' }, subject: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' },
    'platform-type': { type: 'string', default: 'plateforme' }, 'platform-label': { type: 'string', default: 'Plateforme' },
    sql: { type: 'boolean', default: false },
  },
});

const quote = value => value === undefined || value === null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";

try {
  if (!values.issuer || !/^https:\/\/[^\s]+$/.test(values.issuer)) throw new Error('--issuer HTTPS requis');
  if (!values.subject || !values.name) throw new Error('--subject et --name requis');
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(values['platform-type'])) throw new Error('--platform-type invalide');
  const args = [values.issuer, values.subject, values.name, values.email ?? null, values['platform-type'], values['platform-label']];
  if (values.sql) {
    process.stdout.write(`SELECT unoa.bootstrap_platform(${args.map(quote).join(', ')});\n`);
  } else {
    const connectionString = process.env.UNOA_MIGRATION_DATABASE_URL;
    if (!connectionString) throw new Error('Définir UNOA_MIGRATION_DATABASE_URL (compte propriétaire du schéma)');
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      const { rows } = await client.query('SELECT unoa.bootstrap_platform($1, $2, $3, $4, $5, $6) AS account', args);
      console.log('Administrateur de la plateforme créé : compte ' + rows[0].account);
    } finally {
      await client.end();
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
