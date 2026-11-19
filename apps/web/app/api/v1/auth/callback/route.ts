import type { NextRequest } from 'next/server';
import { callbackPath, cookieName, cookieOptions, iamSettings, sessionDurationSeconds } from '@/lib/iam/settings';
import { verifiedSubject } from '@/lib/iam/oidc';
import { openSession } from '@/lib/iam/sessions';
import { redirectTo, unavailable } from '@/lib/iam/responses';

export async function GET(request: NextRequest) {
  const settings = iamSettings();
  if (!settings) return unavailable(callbackPath);

  const loginName = cookieName(settings, 'login');
  const loginCookie = request.cookies.get(loginName)?.value;
  let token: string | null = null;
  let status = 'refuse';
  try {
    const identity = loginCookie && await verifiedSubject(settings, request.nextUrl.search, loginCookie);
    if (identity) {
      try {
        token = await openSession(settings, identity);
      } catch {
        status = 'indisponible';
      }
    }
  } catch (error) {
    console.error('unoa-oidc-validation', error instanceof Error ? error.name : 'UnknownError',
      error instanceof Error && 'code' in error ? error.code : 'unknown');
  }
  const response = redirectTo(new URL(token ? '/espace' : '/connexion?statut=' + status, settings.origin));
  response.cookies.set(loginName, '', cookieOptions(settings, 0));
  if (token) {
    response.cookies.set(cookieName(settings, 'session'), token, cookieOptions(settings, sessionDurationSeconds));
  }
  return response;
}
