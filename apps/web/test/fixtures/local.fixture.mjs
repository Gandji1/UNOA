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
  assert.match(await (await call('/administration', { headers: { Cookie: cookie } })).text(), /Accès et rôles/);

  // Account without code: password only. Lockout after five failures, even with the right password.
  assert.match(where(await signIn('candidat.local', 'Candidat-Secret-9')), /\/espace$/);
  for (let attempt = 0; attempt < 5; attempt++) assert.match(where(await signIn('candidat.local', 'mauvais')), /statut=refuse$/);
  assert.match(where(await signIn('candidat.local', 'Candidat-Secret-9')), /statut=verrouille$/);
  await assert.rejects(database.query("INSERT INTO unoa.local_credential(account_id, login, password_hash) VALUES ($1, 'xyz', 'clair')", [plain.account_id]), /check|duplicate/i);

  // Installation: secret token, then refused once an administrator exists.
  const install = (token, body) => call('/api/v1/installation', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Setup-Token': token } : {}) }, body: JSON.stringify(body) });
  const body = { login: 'premier.admin', displayName: 'Premier administrateur', platformLabel: 'UNOA' };
  assert.equal((await install(null, body)).status, 403);
  assert.equal((await install('mauvais-jeton', body)).status, 403);
  assert.equal((await install(setupToken, body)).status, 409, 'plateforme déjà installée');
  const { rows: audits } = await database.query("SELECT DISTINCT outcome FROM unoa.audit_event WHERE action = 'iam.local_login' ORDER BY outcome");
  assert.deepEqual(audits.map(row => row.outcome), ['allowed', 'denied']);
}
