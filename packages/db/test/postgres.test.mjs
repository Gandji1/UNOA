import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { migrate } from '../src/migrations.mjs';

const connectionString = process.env.UNOA_TEST_DATABASE_URL;
assert.ok(connectionString, 'Définir UNOA_TEST_DATABASE_URL vers le serveur PostgreSQL de test.');
const initial = '0001_scopes.sql';
const next = '0002_identity_audit.sql';

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
    assert.deepEqual(await migrate(database, directory), [initial]);
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
    assert.deepEqual(results.flat(), [next]);
    assert.deepEqual(await migrate(database), []);
    assert.equal((await one('SELECT count(*)::int AS total FROM unoa.scope')).total, 4);
    assert.equal((await one('SELECT count(*)::int AS total FROM unoa.account')).total, 0);
  });

  await context.test('Échec atomique et refus de modification de l’historique', async () => {
    await copyMigration(next);
    const broken = join(directory, '0003_atomic.sql');
    await writeFile(broken, 'CREATE TABLE unoa.atomic_test (id int); SELECT 1 / 0;');
    await assert.rejects(migrate(database, directory), { code: '22012' });
    assert.equal((await one("SELECT to_regclass('unoa.atomic_test') AS relation")).relation, null);
    assert.equal((await one('SELECT count(*)::int AS total FROM unoa_meta.migration')).total, 2);
    await writeFile(join(directory, initial), 'SELECT 1');
    await assert.rejects(migrate(database, directory), /Historique incohérent/);
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
