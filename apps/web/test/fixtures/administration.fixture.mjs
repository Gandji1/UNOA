import assert from 'node:assert/strict';

// Administration of access from an empty platform: bootstrap of the first
// administrator, roles composed in the console, invitation accepted at sign-in,
// anti-escalation, delegation, account disabling, open registration and audit.
// Runs last: the Alpha site created by the academic fixture is online.
export async function exerciseAdministration({ database, issuer, login, call, origin, root, alpha }) {
  await database.query("SELECT unoa.bootstrap_platform($1, 'iam-admin', 'Administratrice de recette', 'admin@example.test', 'platform', 'Racine')", [issuer.origin]);
  await assert.rejects(database.query("SELECT unoa.bootstrap_platform($1, 'iam-other', 'Autre', NULL, 'platform', 'Racine')", [issuer.origin]),
    /already exists/, 'amorçage unique');

  const cookies = {};
  async function enter(name, options) {
    issuer.useIdentity(name, 'test-mfa');
    const result = await login(options);
    const session = result.headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session='));
    if (session) cookies[name] = session.split(';', 1)[0];
    return result.headers.get('location');
  }
  const post = (path, who, data) => call(path, {
    method: 'POST', headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const get = (path, who) => call(path, { headers: who ? { Cookie: cookies[who] } : {} });
  async function okay(response) {
    assert.equal(response.status, 200, response.ok ? '' : JSON.stringify(await response.clone().json()));
    return response.json();
  }
  const status = (response, expected, label) => assert.equal(response.status, expected, label);
  const iam = '/api/v1/iam/';
  const at = hours => new Date(Date.now() + hours * 3_600_000).toISOString();
  const accountOf = async subject => (await database.query('SELECT account_id FROM unoa.login_identity WHERE issuer = $1 AND subject = $2',
    [issuer.origin, subject])).rows[0]?.account_id;

  // 1. The bootstrapped administrator reaches the console and every studio.
  assert.match(await enter('iam-admin'), /\/espace$/);
  const overview = await (await get('/administration', 'iam-admin')).text();
  for (const studio of ['acces', 'structures', 'catalogue', 'cours', 'admissions', 'site', 'territoires', 'parametres']) {
    assert.match(overview, new RegExp(`href="/administration/${studio}"`), studio);
  }
  const catalogue = await okay(await get(iam + 'roles', 'iam-admin'));
  assert.ok(catalogue.permissions.some(item => item.code === 'iam.assign' && item.sensitive));
  assert.deepEqual(catalogue.roles.find(item => item.code === 'platform_admin').permissions.length, catalogue.permissions.length);

  // 2. Roles are composed without code; the bootstrap role stays intact.
  await status(await post(iam + 'roles', 'iam-admin', { code: 'iam_x', label: 'X', permissions: ['inconnue.read'] }), 422, 'permission inconnue');
  await status(await post(iam + 'roles', 'iam-admin', { code: 'platform_admin', label: 'X', permissions: ['org.read'] }), 409, 'rôle réservé');
  await okay(await post(iam + 'roles', 'iam-admin', { code: 'iam_scolarite', label: 'Scolarité', permissions: ['org.read', 'catalog.read'] }));
  await okay(await post(iam + 'roles', 'iam-admin', { code: 'iam_lecteur', label: 'Lecteur des structures', permissions: ['org.read'] }));
  await okay(await post(iam + 'roles', 'iam-admin', {
    code: 'iam_local', label: 'Administrateur local', description: 'Gère les accès de son établissement.',
    permissions: ['iam.read', 'iam.assign', 'iam.manage', 'iam.delegate', 'org.read'],
  }));
  await assert.rejects(database.query("DELETE FROM unoa.role_permission WHERE role_code = 'platform_admin'"), /keeps every permission/);

  // 3. Invitation: link shown once, preview, acceptance at sign-in.
  const invitation = await okay(await post(iam + 'invitations', 'iam-admin', {
    scopeId: alpha, displayName: 'Responsable local', email: 'local@example.test', role: 'iam_local', includeDescendants: true,
    reason: 'Prise de fonction', validDays: 7,
  }));
  const token = invitation.link.split('/invitation/')[1];
  assert.match(await (await get('/invitation/' + token)).text(), /Responsable local/);
  assert.match(await (await get('/invitation/' + 'x'.repeat(43))).text(), /Lien d’invitation invalide/);
  assert.match(await enter('iam-local', { invitation: token }), /\/espace$/);
  const local = await accountOf('iam-local');
  const { rows: [profile] } = await database.query('SELECT display_name, origin FROM unoa.account WHERE id = $1', [local]);
  assert.deepEqual(profile, { display_name: 'Responsable local', origin: 'invitation' });
  assert.match(await (await get('/invitation/' + token)).text(), /déjà été acceptée/);
  assert.match(await enter('iam-intruder', { invitation: token }), /statut=refuse/, 'invitation à usage unique');

  // 4. Anti-escalation and separation: the local administrator acts only within its powers.
  const third = await (async () => { assert.match(await enter('iam-third', { invitation: (await okay(await post(iam + 'invitations', 'iam-admin', {
    scopeId: alpha, displayName: 'Agent', role: 'iam_lecteur', reason: 'Recrutement', validDays: 1, includeDescendants: true,
  }))).link.split('/invitation/')[1] }), /\/espace$/); return accountOf('iam-third'); })();
  const grantTo = (who, data) => post(iam + 'grants', who, { accountId: third, scopeId: alpha, includeDescendants: true, reason: 'Besoin du service', ...data });
  await status(await grantTo('iam-local', { role: 'platform_admin' }), 403, 'escalade vers l’amorçage');
  await status(await grantTo('iam-local', { role: 'iam_scolarite' }), 403, 'permission non détenue (catalog.read)');
  await status(await grantTo('iam-local', { role: 'iam_lecteur', scopeId: root }), 403, 'hors portée');
  await status(await post(iam + 'grants', 'iam-local', { accountId: local, scopeId: alpha, role: 'iam_lecteur', reason: 'x' }), 403, 'auto-attribution');
  await status(await grantTo('iam-local', { role: 'iam_lecteur', reason: '' }), 400, 'justification');
  const granted = await okay(await grantTo('iam-local', { role: 'iam_lecteur', effectiveUntil: at(24) }));
  await assert.rejects(database.query("UPDATE unoa.role_grant SET reason = 'réécrit' WHERE id = $1", [granted.id]), /only shortened or revoked/);
  await assert.rejects(database.query('DELETE FROM unoa.role_grant WHERE id = $1', [granted.id]), /never deleted/);
  const listing = await okay(await get(`${iam}scopes?scopeId=${alpha}&q=Agent`, 'iam-local'));
  assert.deepEqual(listing.accounts.map(item => item.display_name), ['Agent']);
  await status(await get(`${iam}scopes?scopeId=${alpha}`, 'iam-third'), 403, 'annuaire réservé');
  await status(await post(iam + 'roles', 'iam-local', { code: 'iam_y', label: 'Y', permissions: ['org.read'] }), 403, 'composition réservée à la racine');

  // 5. Delegation bounded in time, ended with its source.
  const own = (await okay(await get(`${iam}accounts/${local}`, 'iam-local'))).grants.find(item => item.role_code === 'iam_local');
  await status(await post(iam + 'delegate', 'iam-local', { grantId: own.grant_id, accountId: third, effectiveUntil: at(24 * 120), reason: 'Congé' }), 422, 'durée maximale');
  const delegated = await okay(await post(iam + 'delegate', 'iam-local', { grantId: own.grant_id, accountId: third, effectiveUntil: at(48), reason: 'Congé annuel' }));
  await okay(await get(`${iam}scopes?scopeId=${alpha}`, 'iam-third'));
  await okay(await post(iam + 'revoke', 'iam-admin', { grantId: own.grant_id, accountId: local, reason: 'Fin de fonction' }));
  const { rows: ended } = await database.query('SELECT revoked_at IS NOT NULL AS revoked FROM unoa.role_grant WHERE id = $1', [delegated.id]);
  assert.equal(ended[0].revoked, true, 'la délégation tombe avec sa source');
  await status(await get(`${iam}scopes?scopeId=${alpha}`, 'iam-third'), 403);

  // 6. Account disabling revokes sessions; the administrator cannot disable itself.
  await status(await post(iam + 'disable', 'iam-admin', { accountId: await accountOf('iam-admin'), reason: 'x' }), 403, 'auto-désactivation');
  await okay(await post(iam + 'disable', 'iam-admin', { accountId: third, reason: 'Départ' }));
  await status(await get('/api/v1/me', 'iam-third'), 401);
  assert.match(await enter('iam-third'), /statut=refuse/);
  await okay(await post(iam + 'enable', 'iam-admin', { accountId: third }));
  assert.match(await enter('iam-third'), /\/espace$/);
  await okay(await post(iam + 'sessions', 'iam-third', { accountId: third }));
  await status(await get('/api/v1/me', 'iam-third'), 401, 'fermeture de ses propres sessions');

  // 7. Open registration is decided per site; a registered account has no role.
  assert.match(await enter('iam-visitor'), /statut=refuse/, 'inscription fermée par défaut');
  const { rows: [site] } = await database.query('SELECT site_id FROM unoa.site_host WHERE host = $1', [new URL(origin).host]);
  await okay(await post(`/api/v1/site/sites/${site.site_id}/registration`, 'iam-admin', { open: true }));
  assert.match(await enter('iam-visitor'), /\/espace$/);
  const visitor = await accountOf('iam-visitor');
  assert.equal((await database.query('SELECT origin FROM unoa.account WHERE id = $1', [visitor])).rows[0].origin, 'registration');
  assert.equal((await database.query('SELECT count(*)::int AS total FROM unoa.role_grant WHERE account_id = $1', [visitor])).rows[0].total, 0);
  await okay(await post(iam + 'profile', 'iam-visitor', { displayName: 'Visiteur inscrit', email: 'visiteur@example.test' }));
  assert.match(await (await get('/espace', 'iam-visitor')).text(), /Visiteur inscrit/);
  assert.doesNotMatch(await (await get('/espace', 'iam-visitor')).text(), /href="\/administration"/);
  await okay(await post(`/api/v1/site/sites/${site.site_id}/registration`, 'iam-admin', { open: false }));

  // 8. Audit trail: readable by the platform administrator only, denials included.
  const trail = await okay(await get(`${iam}audit?scopeId=${root}&prefix=iam.`, 'iam-admin'));
  for (const action of ['iam.bootstrap', 'iam.role_created', 'iam.invitation_sent', 'iam.invitation_accepted', 'iam.role_granted',
    'iam.role_delegated', 'iam.role_revoked', 'iam.account_disabled', 'iam.access']) {
    assert.ok(trail.events.some(item => item.action === action), action);
  }
  await status(await get(`${iam}audit?scopeId=${root}`, 'iam-local'), 403);
  assert.match(await (await get(`/administration/acces?vue=journal&scope=${root}`, 'iam-admin')).text(), /iam\.role_granted/);
  assert.match(await (await get(`/administration/acces?compte=${third}`, 'iam-admin')).text(), /Lecteur des structures/);
  assert.match(await (await get('/administration/acces?vue=roles', 'iam-admin')).text(), /Administrateur local/);
}
