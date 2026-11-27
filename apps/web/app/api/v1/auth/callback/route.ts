import { openAccount } from '@/lib/iam/accounts';
import type { NextRequest } from 'next/server';
import { callbackPath, cookieName, cookieOptions, iamSettings } from '@/lib/iam/settings';
import { verifiedSubject } from '@/lib/iam/oidc';
import { openSession } from '@/lib/iam/sessions';
import { provisionIdentity } from '@/lib/iam/admin';
import { siteForRequest } from '@/lib/site/store';
import { redirectTo, unavailable } from '@/lib/server/responses';

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
        const site = await siteForRequest(request).catch(() => null);
        await provisionIdentity(settings, identity, request.cookies.get(cookieName(settings, 'invitation'))?.value, site?.site_id ?? null);
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
  response.cookies.set(cookieName(settings, 'invitation'), '', cookieOptions(settings, 0));
  if (token) {
    openAccount(response, settings, token, [request.cookies.get(cookieName(settings, 'session'))?.value, request.cookies.get(cookieName(settings, 'accounts'))?.value].filter(Boolean).join('.'));
  }
  return response;
}
