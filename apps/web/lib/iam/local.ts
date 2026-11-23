import 'server-only';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { newSecret, otpauthUri, verify } from '@unoa/domain/totp';
import type { IamSettings } from './settings';
import { database, openSession } from './sessions';
import { boundedText, ensure, Problem } from '@/lib/shared/validation';

// Local sign-in (ADR-0010): password hashed with scrypt, one-time code (TOTP)
// required when the account holds a role, lockout after repeated failures,
// every attempt audited. Used while no institutional OIDC provider is set.

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number, options: object) => Promise<Buffer>;
const cost = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const maxAttempts = 5;
const lockMinutes = 15;
export const localIssuer = 'local';

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32, cost);
  return `scrypt$${cost.N}$${cost.r}$${cost.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

async function passwordMatches(password: string, stored: string) {
  const [, N, r, p, salt, expected] = stored.split('$');
  const hash = await scrypt(password, Buffer.from(salt, 'base64url'), 32, { N: Number(N), r: Number(r), p: Number(p), maxmem: cost.maxmem });
  const wanted = Buffer.from(expected, 'base64url');
  return wanted.length === hash.length && timingSafeEqual(wanted, hash);
}

export function checkNewPassword(password: unknown) {
  ensure(typeof password === 'string' && password.length >= 12 && password.length <= 200, 400, 'Mot de passe de 12 à 200 caractères');
  ensure(/[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password), 400, 'Mot de passe : minuscules, majuscules et chiffres requis');
  return password;
}

// A generated password readable aloud: 4 groups, letters and digits.
function generatedPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(20);
  const groups = [0, 5, 10, 15].map(start => [...bytes.subarray(start, start + 5)].map(byte => alphabet[byte % alphabet.length]).join(''));
  return groups.join('-') + '-A7';
}

interface Credential { account_id: string; login: string; password_hash: string; totp_secret: string | null; failed_attempts: number;
  locked_until: Date | null; must_change: boolean; disabled_at: Date | null }

async function audit(settings: IamSettings, actor: string | null, action: string, outcome: 'allowed' | 'denied') {
  await database(settings).query(`INSERT INTO unoa.audit_event(actor_id, action, correlation_id, outcome) VALUES ($1, $2, gen_random_uuid(), $3)`,
    [actor, action, outcome]);
}

export type LocalOutcome = { token: string; mustChange: boolean } | { refused: 'credentials' | 'locked' | 'code' };

export async function localLogin(settings: IamSettings, loginInput: unknown, password: unknown, otp: unknown): Promise<LocalOutcome> {
  const login = typeof loginInput === 'string' ? loginInput.trim().toLowerCase() : '';
  const store = database(settings);
  const { rows } = await store.query<Credential>(`
    SELECT credential.*, account.disabled_at FROM unoa.local_credential AS credential
    JOIN unoa.account ON account.id = credential.account_id WHERE credential.login = $1
  `, [login]);
  const credential = rows[0];
  // Same work and same answer for an unknown identifier.
  if (!credential || typeof password !== 'string' || password.length > 200) {
    await scrypt(String(password ?? '').slice(0, 200), randomBytes(16), 32, cost);
    await audit(settings, null, 'iam.local_login', 'denied');
    return { refused: 'credentials' };
  }
  if (credential.locked_until && credential.locked_until > new Date()) {
    await audit(settings, credential.account_id, 'iam.local_login_locked', 'denied');
    return { refused: 'locked' };
  }
  const passwordOk = await passwordMatches(password, credential.password_hash);
  const codeOk = !credential.totp_secret || (typeof otp === 'string' && verify(credential.totp_secret, otp.replace(/\s/g, '')));
  if (!passwordOk || !codeOk || credential.disabled_at) {
    const locked = credential.failed_attempts + 1 >= maxAttempts;
    await store.query(`UPDATE unoa.local_credential SET failed_attempts = CASE WHEN $2 THEN 0 ELSE failed_attempts + 1 END,
      locked_until = CASE WHEN $2 THEN now() + make_interval(mins => $3) ELSE locked_until END WHERE account_id = $1`,
      [credential.account_id, locked, lockMinutes]);
    await audit(settings, credential.account_id, 'iam.local_login', 'denied');
    return { refused: passwordOk && !codeOk ? 'code' : 'credentials' };
  }
  await store.query('UPDATE unoa.local_credential SET failed_attempts = 0, locked_until = NULL WHERE account_id = $1', [credential.account_id]);
  const token = await openSession(settings, { issuer: localIssuer, subject: credential.login });
  ensure(token, 403, 'Compte indisponible');
  await audit(settings, credential.account_id, 'iam.local_login', 'allowed');
  return { token, mustChange: credential.must_change };
}

export async function changePassword(settings: IamSettings, actor: string, current: unknown, next: unknown) {
  const store = database(settings);
  const { rows } = await store.query<{ password_hash: string }>('SELECT password_hash FROM unoa.local_credential WHERE account_id = $1', [actor]);
  ensure(rows[0], 404, 'Ce compte se connecte par le fournisseur institutionnel');
  ensure(typeof current === 'string' && await passwordMatches(current, rows[0].password_hash), 403, 'Mot de passe actuel incorrect');
  const password = checkNewPassword(next);
  ensure(password !== current, 400, 'Choisir un mot de passe différent');
  await store.query('UPDATE unoa.local_credential SET password_hash = $2, must_change = false, changed_at = now() WHERE account_id = $1',
    [actor, await hashPassword(password)]);
  await audit(settings, actor, 'iam.password_changed', 'allowed');
  return { accountId: actor };
}

// The account holder removes their one-time code (owner decision of 23 November
// 2026, recorded in ADR-0010): current password required, audited, reversible.
export async function disableCode(settings: IamSettings, actor: string, current: unknown) {
  const store = database(settings);
  const { rows } = await store.query<{ password_hash: string; totp_secret: string | null }>(
    'SELECT password_hash, totp_secret FROM unoa.local_credential WHERE account_id = $1', [actor]);
  ensure(rows[0], 404, 'Ce compte se connecte par le fournisseur institutionnel');
  ensure(typeof current === 'string' && await passwordMatches(current, rows[0].password_hash), 403, 'Mot de passe actuel incorrect');
  ensure(rows[0].totp_secret, 409, 'Aucun code de vérification actif');
  await store.query('UPDATE unoa.local_credential SET totp_secret = NULL WHERE account_id = $1', [actor]);
  await audit(settings, actor, 'iam.mfa_disabled', 'allowed');
  return { accountId: actor };
}

// Invitation accepted by choosing a local identifier and password (ADR-0010).
export async function acceptInvitationLocally(settings: IamSettings, token: unknown, loginInput: unknown, password: unknown) {
  const hash = typeof token === 'string' && /^[\w-]{43}$/.test(token) ? createHash('sha256').update(token).digest() : null;
  ensure(hash, 400, 'Lien d’invitation invalide');
  const login = typeof loginInput === 'string' ? loginInput.trim().toLowerCase() : '';
  ensure(/^[a-z0-9][a-z0-9._@-]{2,119}$/.test(login), 400, 'Identifiant : 3 à 120 caractères (lettres minuscules, chiffres, . _ @ -)');
  const secret = checkNewPassword(password);
  try {
    const { rows } = await database(settings).query<{ account: string | null }>('SELECT unoa.accept_invitation_local($1, $2, $3) AS account',
      [hash, login, await hashPassword(secret)]);
    ensure(rows[0]?.account, 410, 'Invitation expirée, retirée ou déjà utilisée');
  } catch (error) {
    if ((error as { code?: string }).code === 'U0409') throw new Problem(409, 'Cet identifiant est déjà pris');
    throw error;
  }
  const session = await openSession(settings, { issuer: localIssuer, subject: login });
  ensure(session, 403, 'Compte indisponible');
  await audit(settings, null, 'iam.invitation_local', 'allowed');
  return session;
}

export async function credentialState(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ login: string; must_change: boolean; totp: boolean }>(
    'SELECT login, must_change, totp_secret IS NOT NULL AS totp FROM unoa.local_credential WHERE account_id = $1', [actor]);
  return rows[0] ?? null;
}

// One-time installation. The token is a secret held by the operator; only its
// SHA-256 is known to the code (UNOA_SETUP_TOKEN_SHA256 may replace it).
const setupTokenHash = process.env.UNOA_SETUP_TOKEN_SHA256 || '2a83e23fc193d386f538d2719bdef0bc37d61449df3d09adcdd6071061fe2e82';

export async function installPlatform(settings: IamSettings, token: string | null, input: Record<string, unknown>) {
  const given = createHash('sha256').update(token ?? '').digest();
  const wanted = Buffer.from(setupTokenHash, 'hex');
  ensure(token && wanted.length === 32 && timingSafeEqual(given, wanted), 403, 'Jeton d’installation invalide');
  const login = boundedText(input.login, 120, 'Identifiant').toLowerCase();
  ensure(/^[a-z0-9][a-z0-9._@-]{2,119}$/.test(login), 400, 'Identifiant invalide');
  const name = boundedText(input.displayName, 200, 'Nom');
  const platform = boundedText(input.platformLabel, 120, 'Nom de la plateforme');
  const password = generatedPassword();
  const secret = newSecret();
  try {
    const { rows } = await database(settings).query<{ account: string }>(
      'SELECT unoa.install_platform($1, $2, $3, $4, $5, $6) AS account', [login, await hashPassword(password), secret, name, 'plateforme', platform]);
    return { account: rows[0].account, login, password, totpSecret: secret, otpauth: otpauthUri(secret, platform, login) };
  } catch (error) {
    if ((error as { code?: string }).code === 'U0409') throw new Problem(409, 'Plateforme déjà installée');
    throw error;
  }
}
