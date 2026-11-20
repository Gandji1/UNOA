import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import pg from 'pg';
import { migrate } from '../../../packages/db/src/migrations.mjs';
import { startIssuer } from './fixtures/oidc-provider.fixture.mjs';
import { exerciseConfiguration } from './fixtures/configuration.fixture.mjs';
import { exerciseTerritory } from './fixtures/territory.fixture.mjs';
import { exerciseAcademic } from './fixtures/academic.fixture.mjs';
import { exerciseLearning } from './fixtures/learning.fixture.mjs';

const ownerUrl = process.env.UNOA_TEST_DATABASE_URL;
assert.ok(ownerUrl, 'UNOA_TEST_DATABASE_URL est requis.');

test('Connexion, droits et configuration via HTTP', { timeout: 240_000 }, async context => {
  const suffix = randomUUID().replaceAll('-', '');
  const name = 'unoa_iam_' + suffix;
  const role = 'unoa_web_' + suffix;
  const password = randomBytes(24).toString('hex');
  const admin = new pg.Client({ connectionString: ownerUrl, connectionTimeoutMillis: 5000 });
  await admin.connect();
  context.after(() => admin.end());
  await admin.query(`CREATE DATABASE ${name} TEMPLATE template0`);
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
  const dataUrl = new URL(ownerUrl);
  dataUrl.pathname = '/' + name;
  const database = new pg.Pool({ connectionString: dataUrl.href, connectionTimeoutMillis: 5000 });
  const issuer = await startIssuer();
  let web;
  context.after(async () => {
    if (web && web.exitCode === null) {
      const exited = once(web, 'exit');
      web.kill();
      await exited;
    }
    await issuer.close();
    await database.end();
    const cleanup = new pg.Client({ connectionString: ownerUrl, connectionTimeoutMillis: 5000 });
    await cleanup.connect();
    try {
      await cleanup.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await cleanup.query(`DROP ROLE ${role}`);
    } finally {
      await cleanup.end();
    }
  });
  await migrate(database);
  const grants = await readFile(new URL('../../../infra/postgres/grant-web.psql', import.meta.url), 'utf8');
  await database.query(grants.replace(/^\\set[^\n]*\n/, '').replaceAll(':"web_role"', role));
  const verifyGrants = await readFile(new URL('../../../infra/postgres/verify-web.psql', import.meta.url), 'utf8');
  const roleChecks = await database.query(verifyGrants.replace(/^\\set[^\n]*\n/, '').replaceAll(":'web_role'", "'" + role + "'"));
  const { base, postgres, migrations, ...privileges } = roleChecks.rows[0];
  assert.equal(base, name);
  // CI pins PostgreSQL 18; a local run may declare another major explicitly.
  assert.match(postgres, new RegExp('^' + (process.env.UNOA_TEST_POSTGRES_MAJOR ?? '18') + '\\.'));
  assert.ok(Number(migrations) >= 4);
  assert.ok(Object.values(privileges).every(allowed => allowed === true));

  const actor = randomUUID();
  const root = randomUUID();
  const alpha = randomUUID();
  const beta = randomUUID();
  await database.query(`
    INSERT INTO unoa.scope_type(code, label, nature)
    VALUES ('platform', 'Racine', 'platform'), ('territory', 'Territoire', 'territory');
    INSERT INTO unoa.scope_type_parent VALUES ('territory', 'platform'), ('territory', 'territory');
    INSERT INTO unoa.access_role VALUES ('local_reader');
    INSERT INTO unoa.permission VALUES ('config.read');
    INSERT INTO unoa.role_permission VALUES ('local_reader', 'config.read');
  `);
  await database.query("INSERT INTO unoa.scope(id, type_code, label) VALUES ($1, 'platform', 'Racine')", [root]);
  await database.query(`
    INSERT INTO unoa.scope(id, type_code, parent_id, label)
    VALUES ($1, 'territory', $3, 'Alpha'), ($2, 'territory', $3, 'Bêta')
  `, [alpha, beta, root]);
  await database.query('INSERT INTO unoa.account(id) VALUES ($1)', [actor]);
  await database.query("INSERT INTO unoa.login_identity VALUES ($1, 'staff-fixture', $2)", [issuer.origin, actor]);
  await database.query(`
    INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from)
    VALUES ($1, $2, 'local_reader', now())
  `, [actor, alpha]);

  const portReservation = createServer();
  await new Promise(resolve => portReservation.listen(0, '127.0.0.1', resolve));
  const port = portReservation.address().port;
  await new Promise(resolve => portReservation.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  // Test-only videoconference key: the adapter signs links, no real provider is called.
  const live = { domain: 'visio.recette.invalid', appId: 'unoa-recette', secret: randomBytes(32).toString('hex') };
  dataUrl.username = role;
  dataUrl.password = password;
  web = spawn(process.execPath, [
    fileURLToPath(import.meta.resolve('next/dist/bin/next')), 'dev', '--webpack',
    '--hostname', '127.0.0.1', '--port', String(port),
  ], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      NEXT_TELEMETRY_DISABLED: '1',
      UNOA_WEB_ORIGIN: origin,
      UNOA_OIDC_ISSUER: issuer.origin,
      UNOA_OIDC_CLIENT_ID: issuer.clientId,
      UNOA_OIDC_CLIENT_SECRET: issuer.clientSecret,
      UNOA_OIDC_MFA_ACR: 'test-mfa',
      UNOA_OIDC_TRANSACTION_KEY: randomBytes(32).toString('base64url'),
      UNOA_IAM_DATABASE_URL: dataUrl.href,
      UNOA_LIVE_JITSI_DOMAIN: live.domain,
      UNOA_LIVE_JITSI_APP_ID: live.appId,
      UNOA_LIVE_JITSI_SECRET: live.secret,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  web.stdout.on('data', value => { serverLog += value; });
  web.stderr.on('data', value => { serverLog += value; });
  const call = (path, options) => fetch(new URL(path, origin), { redirect: 'manual', ...options });
  for (let attempt = 0; attempt < 45; attempt++) {
    if ((await call('/api/v1/health/ready').catch(() => null))?.ok) break;
    assert.equal(web.exitCode, null, 'Le serveur web s’est arrêté.');
    await delay(200);
    assert.ok(attempt < 44, 'Le serveur web ne répond pas.');
  }

  async function login({ changeState = false } = {}) {
    const begin = await call('/api/v1/auth/login', { method: 'POST', headers: { Origin: origin } });
    assert.equal(begin.status, 303);
    const target = new URL(begin.headers.get('location'));
    assert.equal(target.origin, issuer.origin);
    const cookie = begin.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=lax/i);
    const authorization = await fetch(target, { redirect: 'manual' });
    assert.equal(authorization.status, 302);
    const callback = new URL(authorization.headers.get('location'));
    if (changeState) callback.searchParams.set('state', 'wrong-test-state');
    return call(callback, { headers: { Cookie: cookie.split(';', 1)[0] } });
  }

  try {
    assert.equal((await call('/api/v1/me')).status, 401);
    assert.equal((await call('/espace')).status, 307);
    assert.equal((await call('/api/v1/auth/login', { method: 'POST' })).status, 403);
    const entered = await login();
    assert.match(entered.headers.get('location'), /\/espace$/);
    const session = entered.headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session='));
    assert.ok(session);
    const sessionCookie = session.split(';', 1)[0];
    const headers = { Cookie: sessionCookie };
    const digest = createHash('sha256').update(sessionCookie.split('=').at(-1)).digest();
    assert.equal((await database.query('SELECT account_id FROM unoa.login_session WHERE token_hash = $1', [digest])).rows[0].account_id, actor);
    assert.deepEqual(await (await call('/api/v1/me', { headers })).json(), { accountId: actor });
    assert.match(await (await call('/espace', { headers })).text(), /Votre session institutionnelle est active/);
    const check = scope => call('/api/v1/access/check?permission=config.read&scopeId=' + scope, { headers });
    assert.deepEqual(await (await check(alpha)).json(), { allowed: true });
    const denied = await check(beta);
    assert.equal(denied.status, 403);
    const { correlationId } = await denied.json();
    assert.equal((await database.query('SELECT resource_id FROM unoa.audit_event WHERE correlation_id = $1', [correlationId])).rows[0].resource_id, beta);
    assert.equal((await check('bad-scope')).status, 400);
    await database.query("UPDATE unoa.role_grant SET revoked_at = now() WHERE account_id = $1", [actor]);
    assert.equal((await check(alpha)).status, 403);
    assert.equal((await call('/api/v1/auth/logout', { method: 'POST', headers })).status, 403);
    assert.equal((await call('/api/v1/me', { headers })).status, 200);
    assert.equal((await call('/api/v1/auth/logout', { method: 'POST', headers: { ...headers, Origin: origin } })).status, 303);
    assert.equal((await call('/api/v1/me', { headers })).status, 401);

    assert.match((await login({ changeState: true })).headers.get('location'), /statut=refuse$/);
    issuer.useIdentity('staff-fixture', 'test-password');
    assert.match((await login()).headers.get('location'), /statut=refuse$/);
    issuer.useIdentity('unknown-fixture', 'test-mfa');
    assert.match((await login()).headers.get('location'), /statut=refuse$/);
    issuer.useIdentity('staff-fixture', 'test-mfa');
    const renewed = await login();
    const latestCookie = renewed.headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
    await database.query('UPDATE unoa.account SET disabled_at = now() WHERE id = $1', [actor]);
    await database.query('UPDATE unoa.account SET disabled_at = NULL WHERE id = $1', [actor]);
    assert.equal((await call('/api/v1/me', { headers: { Cookie: latestCookie } })).status, 401);
    await context.test('Studio, publication et indépendance territoriale', () =>
      exerciseConfiguration({ database, issuer, call, login, origin, actor, root, alpha, beta }),
    );
    await context.test('Territoires, hiérarchie et rattachements', () =>
      exerciseTerritory({ database, issuer, call, login, origin, root, alpha }),
    );
    await context.test('Structures académiques et catalogue des formations', () =>
      exerciseAcademic({ database, issuer, call, login, origin, root, alpha, beta }),
    );
    await context.test('Studio de cours, apprentissage et classes virtuelles', () =>
      exerciseLearning({ database, issuer, call, login, origin, alpha, live }),
    );
    const storageLog = serverLog.split('\n').filter(line => /unoa-[a-z-]+-storage/.test(line));
    if (storageLog.length) context.diagnostic(storageLog.join('\n'));
  } catch (error) {
    const diagnostic = serverLog.split('\n').filter(line => /unoa-(oidc-validation|config-storage|territory-storage|org-storage|catalog-storage|public-)/.test(line));
    context.diagnostic(diagnostic.join('\n'));
    throw error;
  }
});
