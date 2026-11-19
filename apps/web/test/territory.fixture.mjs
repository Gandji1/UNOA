import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Builds a second country from an empty territorial base, with rules that differ
// from the Alpha and Bêta fixtures, then proves isolation and dated attachments.
export async function exerciseTerritory({ database, issuer, login, call, origin, root, alpha }) {
  const steward = randomUUID();
  const local = randomUUID();
  await database.query(`
    INSERT INTO unoa.access_role VALUES ('territory_steward'), ('territory_local');
    INSERT INTO unoa.permission VALUES ('territory.read'), ('territory.write'), ('territory.define');
    INSERT INTO unoa.role_permission (role_code, permission_code)
    SELECT 'territory_steward', code FROM unoa.permission WHERE code LIKE 'territory.%';
    INSERT INTO unoa.role_permission VALUES ('territory_local', 'territory.read'), ('territory_local', 'territory.write');
  `);
  await database.query('INSERT INTO unoa.account (id) VALUES ($1), ($2)', [steward, local]);
  await database.query(`
    INSERT INTO unoa.login_identity VALUES ($1, 'steward-fixture', $2), ($1, 'local-fixture', $3)
  `, [issuer.origin, steward, local]);
  await database.query(`
    INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants)
    VALUES ($1, $2, 'territory_steward', now(), true), ($3, $4, 'territory_local', now(), false)
  `, [steward, root, local, alpha]);

  async function signIn(subject) {
    issuer.useIdentity(subject, 'test-mfa');
    const result = await login();
    assert.match(result.headers.get('location'), /\/espace$/);
    return result.headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const stewardCookie = await signIn('steward-fixture');
  const localCookie = await signIn('local-fixture');

  const api = '/api/v1/territories/';
  const studio = '/administration/territoires';
  const write = (path, cookie, data) => call(api + path, {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const read = (path, cookie) => call(path, { headers: { Cookie: cookie } });
  async function okay(response) {
    assert.equal(response.status, 200, JSON.stringify(response.ok ? {} : await response.clone().json()));
    return response.json();
  }
  const soon = offsetHours => new Date(Date.now() + offsetHours * 3_600_000).toISOString().slice(0, 16);

  // 1. Types and hierarchy are declared, never hard-coded.
  const declare = (code, label, nature, parentTypes) =>
    write('types', stewardCookie, { scopeId: root, code, label, nature, parentTypes });
  assert.equal((await declare('pays', 'Pays', 'territory', [])).status, 400);
  assert.equal((await declare('pays', 'Pays', 'territory', ['platform'])).status, 200);
  await okay(await declare('region', 'Région', 'territory', ['pays', 'region']));
  await okay(await declare('juridiction', 'Juridiction', 'jurisdiction', ['pays']));
  await okay(await declare('campus', 'Campus', 'institution', ['pays', 'region']));
  await okay(await declare('centre_examen', 'Centre', 'centre', ['campus']));
  assert.equal((await declare('pays', 'Doublon', 'territory', ['platform'])).status, 409);
  assert.equal((await write('types', localCookie,
    { scopeId: root, code: 'autre', label: 'Autre', nature: 'territory', parentTypes: ['platform'] })).status, 403);
  const { types } = await okay(await read(api + 'types', stewardCookie));
  assert.deepEqual(types.find(item => item.code === 'region').parents, ['pays', 'region']);

  // 2. A second country is created from the empty base with its own regional rules.
  const create = (parentId, data, cookie = stewardCookie) =>
    write('scopes', cookie, { scopeId: parentId, parentId, ...data });
  const country = await okay(await create(root, {
    typeCode: 'pays', label: 'Gamma', presentFrom: soon(1),
    timeZone: 'Africa/Porto-Novo', currency: 'XOF', locale: 'fr-BJ',
  }));
  const region = await okay(await create(country.scopeId, {
    typeCode: 'region', label: 'Gamma Littoral', presentFrom: soon(2),
    timeZone: 'Africa/Porto-Novo', currency: 'XOF', locale: 'fr-BJ',
  }));
  const abroad = await okay(await create(root, {
    typeCode: 'pays', label: 'Delta', presentFrom: soon(1),
    timeZone: 'America/Toronto', currency: 'CAD', locale: 'fr-CA',
  }));

  // 3. Unknown regional references and undeclared hierarchies are refused.
  const refused = [
    [{ typeCode: 'pays', label: 'Faux fuseau', presentFrom: soon(1), timeZone: 'Afrique/Nulle' }, 400],
    [{ typeCode: 'pays', label: 'Fausse monnaie', presentFrom: soon(1), currency: 'ZZZ' }, 400],
    [{ typeCode: 'pays', label: 'Faux format', presentFrom: soon(1), locale: 'fr_BJ!' }, 400],
    [{ typeCode: 'juridiction', label: 'Hors hiérarchie', presentFrom: soon(1) }, 422],
    [{ typeCode: 'pays', label: 'Identité illégitime', presentFrom: soon(1), legalName: 'Faux sceau' }, 422],
  ];
  for (const [payload, status] of refused) {
    assert.equal((await create(root, payload)).status, status, payload.label);
  }
  assert.equal((await create(country.scopeId,
    { typeCode: 'region', label: 'Avant la mère', presentFrom: '2020-01-01T00:00' })).status, 422);

  // 4. Establishments carry a legal identity and several dated attachments.
  const campus = await okay(await create(country.scopeId, {
    typeCode: 'campus', label: 'Campus Gamma', presentFrom: soon(2),
    timeZone: 'Africa/Porto-Novo', currency: 'XOF', locale: 'fr-BJ',
    legalName: 'Campus Gamma de l’UNOA', contact: 'contact@example.test',
  }));
  const jurisdiction = await okay(await create(country.scopeId,
    { typeCode: 'juridiction', label: 'Juridiction Gamma', presentFrom: soon(1) }));
  const attach = (scopeId, data, cookie = stewardCookie) =>
    write(`scopes/${scopeId}/attachments`, cookie, { scopeId, ...data });
  const implantation = await okay(await attach(campus.scopeId, {
    territoryId: region.scopeId, kind: 'implantation', reason: 'Implantation principale', effectiveFrom: soon(3),
  }));
  await okay(await attach(campus.scopeId, {
    territoryId: abroad.scopeId, kind: 'implantation', reason: 'Antenne Delta', effectiveFrom: soon(3),
  }));
  await okay(await attach(campus.scopeId, {
    territoryId: jurisdiction.scopeId, kind: 'regulatory', reason: 'Cadre applicable', effectiveFrom: soon(3),
  }));
  assert.equal((await attach(campus.scopeId, {
    territoryId: region.scopeId, kind: 'regulatory', reason: 'Nature incompatible', effectiveFrom: soon(3),
  })).status, 422);
  assert.equal((await attach(campus.scopeId, {
    territoryId: region.scopeId, kind: 'implantation', reason: 'Doublon', effectiveFrom: soon(4),
  })).status, 409);
  assert.equal((await attach(country.scopeId, {
    territoryId: region.scopeId, kind: 'implantation', reason: 'Pays non établissement', effectiveFrom: soon(3),
  })).status, 422);
  const close = (id, scopeId, cookie = stewardCookie) =>
    write(`attachments/${id}/close`, cookie, { scopeId, effectiveUntil: soon(10) });
  await okay(await close(implantation.id, campus.scopeId));
  assert.equal((await close(implantation.id, campus.scopeId)).status, 409);

  // 5. Designations are translated and replaced.
  const label = (scopeId, data, cookie = stewardCookie) => write(`scopes/${scopeId}/labels`, cookie, { scopeId, ...data });
  await okay(await label(country.scopeId, { language: 'fr', label: 'Gamma' }));
  await okay(await label(country.scopeId, { language: 'en', label: 'Gamma Country' }));
  await okay(await label(country.scopeId, { language: 'en', label: 'Republic of Gamma' }));
  assert.equal((await label(country.scopeId, { language: 'FRANCAIS', label: 'Invalide' })).status, 400);

  // 6. Presence windows are closed through the update endpoint.
  const update = (scopeId, data, cookie = stewardCookie) => write(`scopes/${scopeId}/update`, cookie, { scopeId, ...data });
  await okay(await update(abroad.scopeId, {
    label: 'Delta', timeZone: 'America/Toronto', currency: 'CAD', locale: 'fr-CA', presentUntil: soon(48),
  }));
  assert.equal((await update(abroad.scopeId, { label: 'Delta', presentUntil: '2020-01-01T00:00' })).status, 422);
  // Gamma still holds a region, a campus and a jurisdiction: it cannot be closed yet.
  assert.equal((await update(country.scopeId, { label: 'Gamma', presentUntil: soon(72) })).status, 422);

  // 7. Two countries keep contradictory regional rules side by side.
  const gamma = await okay(await read(api + 'scopes?scopeId=' + country.scopeId, stewardCookie));
  const delta = await okay(await read(api + 'scopes?scopeId=' + abroad.scopeId, stewardCookie));
  assert.equal(gamma.scope.currency, 'XOF');
  assert.equal(delta.scope.currency, 'CAD');
  assert.equal(gamma.scope.time_zone, 'Africa/Porto-Novo');
  assert.equal(delta.scope.time_zone, 'America/Toronto');
  assert.deepEqual(gamma.labels.map(item => [item.language, item.label]).sort(),
    [['en', 'Republic of Gamma'], ['fr', 'Gamma']]);
  const establishment = await okay(await read(api + 'scopes?scopeId=' + campus.scopeId, stewardCookie));
  assert.equal(establishment.scope.legal_name, 'Campus Gamma de l’UNOA');
  assert.deepEqual(establishment.attachments.map(item => item.kind).sort(),
    ['implantation', 'implantation', 'regulatory']);

  // 8. A local agent sees and changes nothing outside its own territory.
  assert.equal((await read(api + 'scopes?scopeId=' + country.scopeId, localCookie)).status, 403);
  assert.equal((await create(country.scopeId, { typeCode: 'region', label: 'Intrusion', presentFrom: soon(1) }, localCookie)).status, 403);
  assert.equal((await update(country.scopeId, { label: 'Intrusion' }, localCookie)).status, 403);
  assert.equal((await label(country.scopeId, { language: 'fr', label: 'Intrusion' }, localCookie)).status, 403);
  const denial = await read(api + 'scopes?scopeId=' + campus.scopeId, localCookie);
  assert.equal(denial.status, 403);
  const { correlationId } = await denial.json();
  assert.equal((await database.query(
    "SELECT action FROM unoa.audit_event WHERE correlation_id = $1 AND outcome = 'denied'", [correlationId],
  )).rows[0].action, 'territory.access');

  // 9. The studio renders the institutional identity and leaks nothing across scopes.
  const page = await read(studio + '?scope=' + campus.scopeId, stewardCookie);
  assert.equal(page.status, 200);
  const rendered = await page.text();
  assert.match(rendered, /Campus Gamma de l’UNOA/);
  assert.match(rendered, /Cadre réglementaire/);
  const localView = await read(studio + '?scope=' + campus.scopeId, localCookie);
  assert.doesNotMatch(await localView.text(), /Campus Gamma de l’UNOA/);
  assert.match(await (await read('/espace', stewardCookie)).text(), /Territoires et implantations/);

  const trail = await database.query(
    "SELECT action, count(*)::int AS total FROM unoa.audit_event WHERE action LIKE 'territory.%' GROUP BY action ORDER BY action",
  );
  assert.deepEqual(trail.rows.map(row => row.action), [
    'territory.access', 'territory.attached', 'territory.created',
    'territory.detached', 'territory.label_set', 'territory.type_created', 'territory.updated',
  ]);
}
