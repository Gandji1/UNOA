import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function exerciseConfiguration({ database, issuer, login, call, origin, actor, root, alpha, beta }) {
  const reviewer = randomUUID();
  const betaWriter = randomUUID();
  await database.query(`
    INSERT INTO unoa.access_role VALUES ('config_owner'), ('config_writer');
    INSERT INTO unoa.permission VALUES ('config.write'), ('config.define'), ('config.review'), ('config.publish') ON CONFLICT DO NOTHING;
    INSERT INTO unoa.role_permission (role_code, permission_code)
    SELECT 'config_owner', code FROM unoa.permission WHERE code LIKE 'config.%';
    INSERT INTO unoa.role_permission VALUES
      ('config_writer', 'config.read'), ('config_writer', 'config.write'), ('config_writer', 'config.review');
  `);
  await database.query('INSERT INTO unoa.account (id) VALUES ($1), ($2)', [reviewer, betaWriter]);
  await database.query(`
    INSERT INTO unoa.login_identity VALUES ($1, 'reviewer-fixture', $2), ($1, 'beta-fixture', $3)
  `, [issuer.origin, reviewer, betaWriter]);
  await database.query(`
    INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants)
    VALUES ($1, $2, 'config_writer', now(), false), ($3, $4, 'config_writer', now(), false),
           ($5, $6, 'config_owner', now(), true)
  `, [actor, alpha, betaWriter, beta, reviewer, root]);

  async function signIn(subject) {
    issuer.useIdentity(subject, 'test-mfa');
    const result = await login();
    assert.match(result.headers.get('location'), /\/espace$/);
    return result.headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const alphaCookie = await signIn('staff-fixture');
  const betaCookie = await signIn('beta-fixture');
  const reviewCookie = await signIn('reviewer-fixture');
  const api = '/api/v1/config/';
  const studio = '/administration/parametres';
  const key = 'test.academic_scale';

  const write = (path, cookie, data, requestId = randomUUID()) => call(api + path, {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
    body: JSON.stringify(data),
  });
  const read = (path, cookie) => call(path, { headers: { Cookie: cookie } });
  async function okay(response) {
    assert.equal(response.status, 200, JSON.stringify(response.ok ? {} : await response.clone().json()));
    return response.json();
  }

  const definition = {
    scopeId: root, key, label: 'Échelle de recette', description: 'Définition fictive utilisée pour le test.',
    kind: 'number', minimum: 0, maximum: 100, defaultValue: 20,
    inherits: true, allowOverride: true, allowedTypes: ['platform', 'territory'],
  };
  assert.equal((await write('definitions', alphaCookie, definition)).status, 403);
  await okay(await write('definitions', reviewCookie, definition));
  const catalogue = await okay(await read(api + 'definitions?scopeId=' + alpha, alphaCookie));
  assert.deepEqual(catalogue.definitions.map(item => item.key), [key]);
  assert.match(await (await read('/administration', alphaCookie)).text(), /<a href="\/administration\/parametres"><strong>Paramètres/);

  const at = new Date(Date.now() + 3_600_000).toISOString().slice(0, 16);
  const draft = { scopeId: alpha, key, value: 18, reason: 'Ajustement Alpha', effectiveFrom: at };
  const requestId = randomUUID();
  const registered = await okay(await write('values', alphaCookie, draft, requestId));
  assert.deepEqual(await okay(await write('values', alphaCookie, draft, requestId)), registered);
  assert.equal((await write('values', alphaCookie, { ...draft, value: 17 }, requestId)).status, 409);
  assert.equal((await write('values', alphaCookie, { ...draft, value: 101 })).status, 422);
  assert.equal((await write('values', betaCookie, draft)).status, 403);

  const betaForm = await call(api + 'values', {
    method: 'POST', headers: {
      Origin: origin, Cookie: betaCookie, 'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ ...draft, scopeId: beta, value: '25', reason: 'Ajustement Bêta', requestId: randomUUID() }),
  });
  assert.equal(betaForm.status, 303);
  const betaId = new URL(betaForm.headers.get('location')).searchParams.get('preview');
  assert.ok(betaId);
  const alphaPreview = new URLSearchParams({ scope: alpha, key, preview: registered.id });
  const page = await read(studio + '?' + alphaPreview, alphaCookie);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Valeur de référence/);
  const crossView = await read(studio + '?' + alphaPreview, betaCookie);
  assert.doesNotMatch(await crossView.text(), /Ajustement Alpha/);

  const nextDraft = await okay(await write('values', alphaCookie, { ...draft, value: 19, reason: 'Proposition concurrente' }));
  const change = (action, item, scopeId, cookie, previewVersion = null) =>
    write('versions/' + item + '/' + action, cookie, { scopeId, key, previewVersion });
  await okay(await change('submit', registered.id, alpha, alphaCookie));
  assert.equal((await change('approve', registered.id, alpha, alphaCookie)).status, 403);
  assert.equal((await change('approve', registered.id, alpha, reviewCookie, 999)).status, 409);
  await okay(await change('approve', registered.id, alpha, reviewCookie));
  await okay(await change('submit', nextDraft.id, alpha, alphaCookie));
  await okay(await change('approve', nextDraft.id, alpha, reviewCookie));
  await okay(await change('submit', betaId, beta, betaCookie));
  await okay(await change('approve', betaId, beta, reviewCookie));

  const published = await Promise.all([
    change('publish', registered.id, alpha, reviewCookie),
    change('publish', registered.id, alpha, reviewCookie),
  ]);
  assert.deepEqual(published.map(result => result.status).sort(), [200, 409]);
  assert.equal((await change('publish', nextDraft.id, alpha, reviewCookie)).status, 409);
  await okay(await change('publish', betaId, beta, reviewCookie));

  const resolve = (scopeId, cookie, when = '') =>
    read(api + 'resolve?' + new URLSearchParams({ scopeId, key, at: when }), cookie);
  assert.equal((await okay(await resolve(alpha, alphaCookie))).value, 20);
  const alphaValue = await okay(await resolve(alpha, alphaCookie, at));
  const betaValue = await okay(await resolve(beta, betaCookie, at));
  assert.equal(alphaValue.value, 18);
  assert.equal(alphaValue.source.scope, 'Alpha');
  assert.equal(betaValue.value, 25);
  assert.equal(betaValue.source.scope, 'Bêta');
  assert.equal((await resolve(beta, alphaCookie, at)).status, 403);
  assert.equal((await resolve(alpha, alphaCookie, '2026-02-30T15:00')).status, 400);
  const events = await database.query('SELECT version_id FROM unoa.config_publication_event ORDER BY version_id');
  assert.deepEqual(events.rows.map(event => event.version_id).sort(), [registered.id, betaId].sort());
  assert.equal((await database.query("SELECT count(*)::int FROM unoa.audit_event WHERE action = 'config.publish'")).rows[0].count, 2);

  const locked = { ...definition, key: 'test.shared_limit', allowOverride: false };
  await okay(await write('definitions', reviewCookie, locked));
  assert.equal((await write('values', alphaCookie, { ...draft, key: locked.key })).status, 422);
  assert.equal((await write('definitions', reviewCookie, { ...definition, key: 'test.invalid', defaultValue: 101 })).status, 422);

  const global = { ...definition, key: 'test.inherited_scale', defaultValue: 10 };
  await okay(await write('definitions', reviewCookie, global));
  const rootDraft = await okay(await write('values', reviewCookie, { ...draft, scopeId: root, key: global.key, value: 40 }));
  // A distinct reviewer receives an exact root grant with no publication authority.
  await database.query("INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from) VALUES ($1, $2, 'config_writer', now())", [actor, root]);
  for (const [action, cookie] of [['submit', reviewCookie], ['approve', alphaCookie], ['publish', reviewCookie]]) {
    await okay(await write('versions/' + rootDraft.id + '/' + action, cookie, { scopeId: root, key: global.key, previewVersion: null }));
  }
  const inherited = await okay(await read(api + 'resolve?' + new URLSearchParams({ scopeId: beta, key: global.key, at }), betaCookie));
  assert.equal(inherited.value, 40);
  assert.equal(inherited.source.scope, 'Racine');
}
