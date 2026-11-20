import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { generateConsoleSql } from '../src/console-sql.mjs';
import { migrate } from '../src/migrations.mjs';

const connectionString = process.env.UNOA_TEST_DATABASE_URL;
assert.ok(connectionString, 'Définir UNOA_TEST_DATABASE_URL vers le serveur PostgreSQL de test.');
const initial = '0001_scopes.sql';
const next = '0002_identity_audit.sql';
const sessions = '0003_sessions.sql';
const config = '0004_configuration.sql';
const territories = '0005_territories.sql';

test('Socle PostgreSQL UNOA', async context => {
  const name = 'unoa_test_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({ connectionString, connectionTimeoutMillis: 5_000 });
  context.after(() => admin.end());
  await admin.query(`CREATE DATABASE ${name} TEMPLATE template0`);
  const databaseUrl = new URL(connectionString);
  databaseUrl.pathname = '/' + name;
  const database = new pg.Pool({ connectionString: databaseUrl.href, connectionTimeoutMillis: 5_000 });
  // Clean up this test's isolated database before closing the administrative pool.
  context.after(async () => {
    const cleanup = new pg.Client({ connectionString, connectionTimeoutMillis: 5_000 });
    await database.end();
    await cleanup.connect();
    try {
      await cleanup.query(`DROP DATABASE ${name}`);
    } finally {
      await cleanup.end();
    }
  });
  const directory = await mkdtemp(join(tmpdir(), 'unoa-migrations-'));
  context.after(() => rm(directory, { recursive: true }));
  const copyMigration = file => copyFile(new URL('../migrations/' + file, import.meta.url), join(directory, file));
  const one = async (sql, values) => (await database.query(sql, values)).rows[0];

  const root = randomUUID();
  const alpha = randomUUID();
  const beta = randomUUID();
  const campus = randomUUID();

  await context.test('Migration sur base vierge puis peuplée et exécution concurrente', async () => {
    await copyMigration(initial);
    const sql = await generateConsoleSql(name, directory);
    await database.query(sql);
    await database.query(sql);
    assert.deepEqual(await migrate(database, directory), []);
    assert.equal((await one('SELECT count(*)::int AS total FROM unoa.scope')).total, 0);
    await database.query(`
      INSERT INTO unoa.scope_type(code, label)
      VALUES ('platform', 'Plateforme de test'), ('territory', 'Territoire'), ('campus', 'Campus')
    `);
    await database.query(
      "INSERT INTO unoa.scope(id, type_code, label) VALUES ($1, 'platform', 'Racine')",
      [root],
    );
    await database.query(`
      INSERT INTO unoa.scope(id, type_code, parent_id, label)
      VALUES ($1, 'territory', $3, 'Alpha'), ($2, 'territory', $3, 'Bêta')
    `, [alpha, beta, root]);
    await database.query(
      "INSERT INTO unoa.scope(id, type_code, parent_id, label) VALUES ($1, 'campus', $2, 'Campus Alpha')",
      [campus, alpha],
    );
    const results = await Promise.all([migrate(database), migrate(database)]);
    assert.deepEqual(results.flat(), [next, sessions, config, territories]);
    assert.deepEqual(await migrate(database), []);
    assert.equal((await one('SELECT count(*)::int AS total FROM unoa.scope')).total, 4);
    assert.equal((await one('SELECT count(*)::int AS total FROM unoa.account')).total, 0);
    // Types created before the territorial migration keep the territory nature,
    // and no hierarchy is declared yet, so a new scope is refused until reviewed.
    assert.equal((await one("SELECT nature FROM unoa.scope_type WHERE code = 'platform'")).nature, 'territory');
    await assert.rejects(database.query(
      "INSERT INTO unoa.scope(type_code, parent_id, label) VALUES ('territory', $1, 'Non déclarée')", [root],
    ), { code: '23514' });
    await database.query(`
      UPDATE unoa.scope_type SET nature = 'platform' WHERE code = 'platform';
      UPDATE unoa.scope_type SET nature = 'institution' WHERE code = 'campus';
      INSERT INTO unoa.scope_type_parent
      VALUES ('territory', 'platform'), ('territory', 'territory'), ('campus', 'territory');
    `);
  });

  await context.test('Hiérarchie déclarée, présence et identité légale contrôlées en base', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await assert.rejects(database.query(
      "INSERT INTO unoa.scope(type_code, parent_id, label) VALUES ('campus', $1, 'Hors hiérarchie')", [root],
    ), { code: '23514' });
    await assert.rejects(database.query(
      `INSERT INTO unoa.scope(type_code, parent_id, label, present_from)
       VALUES ('territory', $1, 'Avant la mère', '2000-01-01T00:00Z')`, [alpha],
    ), { code: '23514' });
    await assert.rejects(database.query(
      "UPDATE unoa.scope SET legal_name = 'Faux sceau' WHERE id = $1", [alpha],
    ), { code: '23514' });
    await assert.rejects(database.query(
      "UPDATE unoa.scope SET time_zone = 'Afrique/Nulle' WHERE id = $1", [alpha],
    ), { code: '23514' });
    await database.query(
      "UPDATE unoa.scope SET time_zone = 'Africa/Porto-Novo', currency = 'XOF' WHERE id = $1", [alpha],
    );
    // A region is closed only once the scopes it holds are closed themselves.
    await assert.rejects(database.query(
      'UPDATE unoa.scope SET present_until = $2 WHERE id = $1', [alpha, future],
    ), { code: '23514' });
    await database.query('UPDATE unoa.scope SET present_until = $2 WHERE id = $1', [campus, future]);
    await database.query('UPDATE unoa.scope SET present_until = $2 WHERE id = $1', [alpha, future]);
    await assert.rejects(database.query(
      "INSERT INTO unoa.scope(type_code, parent_id, label) VALUES ('territory', $1, 'Sans terme')", [alpha],
    ), { code: '23514' });
    await database.query(
      "UPDATE unoa.scope SET legal_name = 'Campus Alpha de test', contact = 'contact@example.test' WHERE id = $1",
      [campus],
    );
    await assert.rejects(database.query(
      `INSERT INTO unoa.scope_attachment(scope_id, territory_id, kind, reason, effective_from)
       VALUES ($1, $2, 'regulatory', 'Nature incompatible', now())`, [campus, beta],
    ), { code: '23514' });
    await database.query(
      `INSERT INTO unoa.scope_attachment(scope_id, territory_id, kind, reason, effective_from)
       VALUES ($1, $2, 'implantation', 'Antenne Bêta', now())`, [campus, beta],
    );
    assert.equal((await one(
      'SELECT count(*)::int AS total FROM unoa.scope_attachment WHERE scope_id = $1', [campus],
    )).total, 1);
  });

  await context.test('Échec atomique et refus de modification de l’historique', async () => {
    await copyMigration(next);
    await copyMigration(sessions);
    await copyMigration(config);
    await copyMigration(territories);
    const broken = join(directory, '0006_atomic.sql');
    await writeFile(broken, 'CREATE TABLE unoa.atomic_test (id int); SELECT 1 / 0;');
    await assert.rejects(migrate(database, directory), { code: '22012' });
    assert.equal((await one("SELECT to_regclass('unoa.atomic_test') AS relation")).relation, null);
    assert.equal((await one('SELECT count(*)::int AS total FROM unoa_meta.migration')).total, 5);
    await writeFile(join(directory, initial), 'SELECT 1');
    await assert.rejects(migrate(database, directory), /Historique incohérent/);

    // Use an explicit client to roll back after a refused SQL editor transaction.
    const editor = await database.connect();
    try {
      await assert.rejects(editor.query(await generateConsoleSql('autre_base')), /Base inattendue/);
      await editor.query('ROLLBACK');
      await assert.rejects(editor.query(await generateConsoleSql(name, directory)), /Historique des migrations incohérent/);
      await editor.query('ROLLBACK');
      await editor.query(await generateConsoleSql(name));
    } finally {
      editor.release();
    }
  });

  await context.test('Parent inexistant, seconde racine et changement d’ascendance rejetés', async () => {
    await assert.rejects(database.query(
      "INSERT INTO unoa.scope(type_code, parent_id, label) VALUES ('territory', $1, 'Invalide')",
      [randomUUID()],
    ), { code: '23503' });
    await assert.rejects(database.query(
      "INSERT INTO unoa.scope(type_code, label) VALUES ('platform', 'Autre racine')",
    ), { code: '23505' });
    await assert.rejects(database.query(
      'UPDATE unoa.scope SET parent_id = $1 WHERE id = $2', [campus, alpha],
    ), { code: '23514' });
  });

  const actor = randomUUID();
  await context.test('Droits atomiques, cloisonnement, expiration et révocation', async () => {
    await database.query('INSERT INTO unoa.account(id) VALUES ($1)', [actor]);
    await database.query(`
      INSERT INTO unoa.login_identity(issuer, subject, account_id)
      VALUES ('https://identity.invalid', 'test-only', $1)
    `, [actor]);
    await assert.rejects(database.query(`
      INSERT INTO unoa.login_identity(issuer, subject, account_id)
      VALUES ('https://identity.invalid', 'test-only', $1)
    `, [actor]), { code: '23505' });
    await database.query(`
      INSERT INTO unoa.access_role(code) VALUES ('territory_reader');
      INSERT INTO unoa.permission(code) VALUES ('config.read'), ('config.write');
      INSERT INTO unoa.role_permission VALUES ('territory_reader', 'config.read');
    `);
    await database.query(`
      INSERT INTO unoa.role_grant(account_id, role_code, scope_id, effective_from)
      VALUES ($1, 'territory_reader', $2, now() - interval '1 hour')
    `, [actor, alpha]);
    async function canRead(scope, permission = 'config.read', account = actor) {
      return (await one('SELECT unoa.has_scope_permission($1, $2, $3) AS allowed',
        [account, permission, scope])).allowed;
    }
    assert.equal(await canRead(alpha), true);
    for (const scope of [campus, beta, root, randomUUID()]) assert.equal(await canRead(scope), false);
    assert.equal(await canRead(alpha, 'config.write'), false);
    assert.equal(await canRead(alpha, 'config.read', randomUUID()), false);
    await database.query('UPDATE unoa.role_grant SET include_descendants = true WHERE account_id = $1', [actor]);
    assert.equal(await canRead(campus), true);
    assert.equal(await canRead(beta), false);
    await database.query("UPDATE unoa.role_grant SET effective_until = now() - interval '1 minute'");
    assert.equal(await canRead(alpha), false);
    await database.query("UPDATE unoa.role_grant SET effective_until = NULL, effective_from = now() + interval '1 hour'");
    assert.equal(await canRead(alpha), false);
    await database.query("UPDATE unoa.role_grant SET effective_from = now() - interval '1 hour', revoked_at = now()");
    assert.equal(await canRead(alpha), false);
    await database.query('UPDATE unoa.role_grant SET revoked_at = NULL');
    await database.query('UPDATE unoa.account SET disabled_at = now() WHERE id = $1', [actor]);
    assert.equal(await canRead(alpha), false);
  });

  await context.test('Audit préservé après modification, suppression et vidage refusés', async () => {
    const correlation = randomUUID();
    await database.query(`
      INSERT INTO unoa.audit_event(actor_id, scope_id, action, correlation_id, outcome)
      VALUES ($1, $2, 'config.read', $3, 'denied')
    `, [actor, beta, correlation]);
    for (const sql of [
      "UPDATE unoa.audit_event SET outcome = 'allowed'",
      'DELETE FROM unoa.audit_event',
      'TRUNCATE unoa.audit_event',
    ]) {
      await assert.rejects(database.query(sql), { code: '55000' });
    }
    assert.equal((await one('SELECT outcome FROM unoa.audit_event WHERE correlation_id = $1', [correlation])).outcome, 'denied');
  });
});
