import 'server-only';
import type { NextResponse } from 'next/server';
import { cookieName, cookieOptions, sessionDurationSeconds, type IamSettings } from './settings';
import { database } from './sessions';
import { createHash } from 'node:crypto';

// Several accounts open in one browser (owner's request): the session tokens
// stay in an HttpOnly cookie; the current one is the session cookie.
const most = 6;
const shape = /^[\w-]{43}$/;

export function remembered(value?: string) {
  return (value ?? '').split('.').filter(token => shape.test(token)).slice(0, most);
}

export function openAccount(response: NextResponse, settings: IamSettings, token: string, previous?: string) {
  const list = [token, ...remembered(previous).filter(item => item !== token)].slice(0, most);
  response.cookies.set(cookieName(settings, 'session'), token, cookieOptions(settings, sessionDurationSeconds));
  response.cookies.set(cookieName(settings, 'accounts'), list.join('.'), cookieOptions(settings, sessionDurationSeconds));
  return response;
}

export function forgetAccount(response: NextResponse, settings: IamSettings, token: string | undefined, previous?: string) {
  const list = remembered(previous).filter(item => item !== token);
  response.cookies.set(cookieName(settings, 'session'), list[0] ?? '', cookieOptions(settings, list.length ? sessionDurationSeconds : 0));
  response.cookies.set(cookieName(settings, 'accounts'), list.join('.'), cookieOptions(settings, list.length ? sessionDurationSeconds : 0));
  return list.length > 0;
}

export type OpenAccount = { index: number; name: string; login: string | null; current: boolean };

// Accounts whose session is still valid, in the order they were opened.
export async function openAccounts(settings: IamSettings, value: string | undefined, current: string | undefined): Promise<OpenAccount[]> {
  const tokens = remembered(value);
  if (current && shape.test(current) && !tokens.includes(current)) tokens.unshift(current);
  if (!tokens.length) return [];
  const hashes = tokens.map(token => createHash('sha256').update(token).digest());
  const { rows } = await database(settings).query<{ position: number; display_name: string | null; login: string | null }>(`
    SELECT item.position::int AS position, account.display_name, credential.login
    FROM unnest($1::bytea[]) WITH ORDINALITY AS item(hash, position)
    JOIN unoa.login_session AS session ON session.token_hash = item.hash
    JOIN unoa.account AS account ON account.id = session.account_id
    LEFT JOIN unoa.local_credential AS credential ON credential.account_id = account.id
    WHERE session.expires_at > statement_timestamp() AND session.revoked_at IS NULL
      AND account.disabled_at IS NULL AND session.account_epoch = account.session_epoch
    ORDER BY item.position`, [hashes]);
  return rows.map(row => ({ index: row.position - 1, name: row.display_name ?? row.login ?? 'Compte', login: row.login, current: tokens[row.position - 1] === current }));
}
