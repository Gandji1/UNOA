import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { code, newSecret } from '../../../../packages/domain/src/totp.ts';

const hash = password => {
  const salt = randomBytes(16);
  return `scrypt$32768$8$1$${salt.toString('base64url')}$${scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64url')}`;
};

// Local sign-in: password + one-time code, lockout, password change, and the
// one-time installation endpoint (token, already installed).
export async function exerciseLocal({ database, call, origin, setupToken }) {
  const { rows: [admin] } = await database.query("SELECT account_id FROM unoa.login_identity WHERE subject = 'iam-admin'");
  const { rows: [plain] } = await database.query("SELECT account_id FROM unoa.login_identity WHERE subject = 'not-quiet'");
  const secret = newSecret();
  await database.query(`INSERT INTO unoa.local_credential(account_id, login, password_hash, totp_secret) VALUES ($1, 'admin.local', $2, $3)`,
    [admin.account_id, hash('Provisoire-2026-A'), secret]);
  await database.query(`INSERT INTO unoa.login_identity VALUES ('local', 'admin.local', $1)`, [admin.account_id]);
  await database.query(`INSERT INTO unoa.local_credential(account_id, login, password_hash, must_change) VALUES ($1, 'candidat.local', $2, false)`,
    [plain.account_id, hash('Candidat-Secret-9')]);
  await database.query(`INSERT INTO unoa.login_identity VALUES ('local', 'candidat.local', $1)`, [plain.account_id]);

  const signIn = (login, password, otp = '') => call('/api/v1/auth/local', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ login, password, code: otp }).toString(),
  });
  const where = response => response.headers.get('location');
  const session = response => response.headers.getSetCookie().find(item => item.startsWith('unoa_session='))?.split(';', 1)[0];

  assert.equal((await call('/api/v1/auth/local', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'login=x' })).status, 403);
  assert.match(where(await signIn('inconnu', 'x')), /statut=refuse$/);
  assert.match(where(await signIn('admin.local', 'Provisoire-2026-A')), /statut=code$/, 'code exigé');
  assert.match(where(await signIn('admin.local', 'Provisoire-2026-A', '000000')), /statut=code$/);
  const entered = await signIn('admin.local', 'Provisoire-2026-A', code(secret));
  assert.match(where(entered), /\/espace\?changer=1#mot-de-passe$/, 'mot de passe provisoire à changer');
  const cookie = session(entered);
  assert.ok(cookie);
  assert.match(await (await call('/espace', { headers: { Cookie: cookie } })).text(), /celui qui vous a été remis est provisoire/);
  const change = data => call('/api/v1/auth/password', { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal((await change({ current: 'faux', password: 'Nouveau-Secret-2026' })).status, 403);
  assert.equal((await change({ current: 'Provisoire-2026-A', password: 'court' })).status, 400);
  assert.equal((await change({ current: 'Provisoire-2026-A', password: 'Nouveau-Secret-2026' })).status, 200);
  assert.match(where(await signIn('admin.local', 'Nouveau-Secret-2026', code(secret))), /\/espace$/);
  assert.match(await (await call('/administration', { headers: { Cookie: cookie } })).text(), /Utilisateurs et rôles/);

  // Account without code: password only. Lockout after five failures, even with the right password.
  assert.match(where(await signIn('candidat.local', 'Candidat-Secret-9')), /\/espace$/);
  for (let attempt = 0; attempt < 5; attempt++) assert.match(where(await signIn('candidat.local', 'mauvais')), /statut=refuse$/);
  assert.match(where(await signIn('candidat.local', 'Candidat-Secret-9')), /statut=verrouille$/);
  await assert.rejects(database.query("INSERT INTO unoa.local_credential(account_id, login, password_hash) VALUES ($1, 'xyz', 'clair')", [plain.account_id]), /check|duplicate/i);

  // Invitation accepted with a local identifier; role levels respected.
  const iam = (action, data) => call('/api/v1/iam/' + action, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const { rows: [alpha] } = await database.query("SELECT id FROM unoa.scope WHERE label = 'Université Alpha'");
  const { rows: [root] } = await database.query('SELECT id FROM unoa.scope WHERE parent_id IS NULL');
  const rector = { scopeId: alpha.id, displayName: 'Admin Alpha', role: 'institution_admin', reason: 'Nomination', validDays: 7, includeDescendants: true };
  // Cascade (ADR-0016): the rector is named by the country administrator, not by the super-administrator.
  assert.equal((await iam('invitations', rector)).status, 403, 'le super-administrateur ne nomme pas le recteur');
  await database.query(`INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants)
    SELECT account_id, (SELECT parent_id FROM unoa.scope WHERE id = $1), 'country_admin', now(), true FROM unoa.local_credential WHERE login = 'admin.local'`, [alpha.id]);
  const invited = await (await iam('invitations', rector)).json();
  assert.ok(invited.link, JSON.stringify(invited));
  const token = invited.link.split('/invitation/')[1];
  const accept = data => call('/api/v1/auth/invitation', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ invitation: token, ...data }).toString() });
  assert.match(where(await accept({ login: 'admin.alpha', password: 'Alpha-Secret-2026', confirm: 'autre' })), /erreur=422$/);
  assert.match(where(await accept({ login: 'admin.alpha', password: 'faible', confirm: 'faible' })), /erreur=400$/);
  assert.match(where(await accept({ login: 'admin.local', password: 'Alpha-Secret-2026', confirm: 'Alpha-Secret-2026' })), /erreur=409$/, 'identifiant pris');
  const welcomed = await accept({ login: 'admin.alpha', password: 'Alpha-Secret-2026', confirm: 'Alpha-Secret-2026' });
  assert.match(where(welcomed), /\/espace\?bienvenue=1$/);
  assert.match(where(await accept({ login: 'admin.alpha2', password: 'Alpha-Secret-2026', confirm: 'Alpha-Secret-2026' })), /erreur=410$/, 'invitation à usage unique');
  const alphaCookie = session(await signIn('admin.alpha', 'Alpha-Secret-2026'));
  const alphaConsole = await (await call('/administration', { headers: { Cookie: alphaCookie } })).text();
  assert.match(alphaConsole, /Recteur \(Université Alpha\)/);
  assert.match(alphaConsole, /href="\/administration\/structures"/);
  assert.doesNotMatch(alphaConsole, /Mise en route de la plateforme/, 'réservé à la plateforme');
  assert.match(await (await call('/administration/guide', { headers: { Cookie: alphaCookie } })).text(), /Qui crée quoi/);
  const { rows: [alphaAdmin] } = await database.query("SELECT account_id FROM unoa.local_credential WHERE login = 'admin.alpha'");
  assert.equal((await iam('grants', { accountId: alphaAdmin.account_id, scopeId: alpha.id, role: 'territory_manager', reason: 'x', includeDescendants: true })).status, 422,
    'rôle de plateforme hors racine');
  assert.equal((await iam('grants', { accountId: alphaAdmin.account_id, scopeId: root.id, role: 'auditor', reason: 'Contrôle', includeDescendants: true })).status, 200);
  assert.match(await (await call('/administration', { headers: { Cookie: cookie } })).text(), /Mise en route de la plateforme/);
  // Hierarchy: a country administrator on a territory, never on an establishment.
  const { rows: [country] } = await database.query("SELECT id FROM unoa.scope WHERE label = 'Alpha' AND parent_id IS NOT NULL");
  const countryInvite = data => iam('invitations', { displayName: 'Admin pays', role: 'country_admin', reason: 'Nomination', validDays: 7, includeDescendants: true, ...data });
  assert.equal((await countryInvite({ scopeId: alpha.id })).status, 422, 'administrateur pays sur un établissement refusé');
  assert.equal((await countryInvite({ scopeId: country.id })).status, 200);
  assert.equal((await iam('invitations', { scopeId: country.id, displayName: 'Doyen', role: 'dean', reason: 'x', validDays: 7 })).status, 422,
    'doyen sur un pays refusé');

  // Candidate self-registration: only on a site that opened account creation.
  const register = data => call('/api/v1/auth/register', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ displayName: 'Candidate locale', login: 'candidate.web', password: 'Candidate-2026-OK', confirm: 'Candidate-2026-OK', ...data }).toString() });
  assert.match(where(await register({})), /erreur=403$/, 'création fermée');
  const { rows: [site] } = await database.query('SELECT site_id FROM unoa.site_host WHERE host = $1', [new URL(origin).host]);
  assert.equal((await call(`/api/v1/site/sites/${site.site_id}/registration`, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ open: true }) })).status, 200);
  assert.match(where(await register({ confirm: 'autre' })), /erreur=422$/);
  assert.match(where(await register({ password: 'faible', confirm: 'faible' })), /erreur=400$/);
  const registered = await register({});
  assert.match(where(registered), /\/espace\?bienvenue=1$/);
  assert.ok(session(registered));
  assert.match(where(await register({})), /erreur=409$/, 'identifiant pris');
  const { rows: [candidate] } = await database.query("SELECT account.origin, (SELECT count(*)::int FROM unoa.role_grant WHERE account_id = account.id) AS grants FROM unoa.local_credential JOIN unoa.account ON account.id = local_credential.account_id WHERE login = 'candidate.web'");
  assert.deepEqual(candidate, { origin: 'registration', grants: 0 });
  assert.match(where(await signIn('candidate.web', 'Candidate-2026-OK')), /\/espace$/);

  // Creation assistants, usual types in one click, development mode and password reset.
  const asAdmin = (path, data) => call(path, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.match(await (await call('/administration/creer', { headers: { Cookie: cookie } })).text(), /Créer les types usuels manquants/);
  const created = await (await asAdmin('/api/v1/setup/standard-types', {})).json();
  assert.ok(Array.isArray(created.created), JSON.stringify(created));
  assert.equal((await (await asAdmin('/api/v1/setup/standard-types', {})).json()).created.length, 0, 'idempotent');
  assert.equal((await call('/api/v1/setup/standard-types', { method: 'POST', headers: { Origin: origin, Cookie: alphaCookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  const facultyPage = await (await call(`/administration/creer?quoi=faculte&dans=${alpha.id}`, { headers: { Cookie: alphaCookie } })).text();
  assert.match(facultyPage, /Créer une faculté/);
  assert.match(await (await call('/administration/creer?quoi=pays', { headers: { Cookie: alphaCookie } })).text(), /Aucun emplacement/, 'pas de pays pour un administrateur d’établissement');
  assert.match(await (await call(`/administration/creer?quoi=responsable&dans=${alpha.id}`, { headers: { Cookie: alphaCookie } })).text(), /Créer l’invitation/);
  assert.equal((await asAdmin('/api/v1/iam/reset-password', { accountId: alphaAdmin.account_id, password: '1' })).status, 400, 'mot de passe faible hors mode développement');
  assert.equal((await call('/api/v1/iam/development-mode', { method: 'POST', headers: { Origin: origin, Cookie: alphaCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) })).status, 403);
  assert.equal((await asAdmin('/api/v1/iam/development-mode', { enabled: true })).status, 200);
  assert.match(await (await call('/connexion')).text(), /Mode développement/);
  assert.equal((await asAdmin('/api/v1/iam/reset-password', { accountId: alphaAdmin.account_id, password: '1' })).status, 200);
  for (let attempt = 0; attempt < 6; attempt++) await signIn('admin.alpha', 'faux');
  assert.match(where(await signIn('admin.alpha', '1')), /\/espace$/, 'aucun blocage en mode développement');
  assert.equal((await asAdmin('/api/v1/iam/development-mode', { enabled: false })).status, 200);
  assert.doesNotMatch(await (await call('/connexion')).text(), /Mode développement/);

  // Installation: secret token, then refused once an administrator exists.
  const install = (token, body) => call('/api/v1/installation', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Setup-Token': token } : {}) }, body: JSON.stringify(body) });
  const body = { login: 'premier.admin', displayName: 'Premier administrateur', platformLabel: 'UNOA' };
  assert.equal((await install(null, body)).status, 403);
  assert.equal((await install('mauvais-jeton', body)).status, 403);
  assert.equal((await install(setupToken, body)).status, 409, 'plateforme déjà installée');
  const { rows: audits } = await database.query("SELECT DISTINCT outcome FROM unoa.audit_event WHERE action = 'iam.local_login' ORDER BY outcome");
  assert.deepEqual(audits.map(row => row.outcome), ['allowed', 'denied']);
}
