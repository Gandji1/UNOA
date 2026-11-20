import type { NextRequest } from 'next/server';
import { cookieName, cookieOptions, iamSettings, loginDurationSeconds } from '@/lib/iam/settings';
import { startLogin } from '@/lib/iam/oidc';
import { problem, redirectTo, unavailable } from '@/lib/server/responses';

const path = '/api/v1/auth/login';

export async function POST(request: NextRequest) {
  const settings = iamSettings();
  if (!settings) return unavailable(path);
  if (request.headers.get('origin') !== settings.origin.origin) {
    return problem(403, 'Origine de la demande refusée', path);
  }
  try {
    const form = request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')
      ? new URLSearchParams((await request.text()).slice(0, 2048)) : null;
    const invitation = form?.get('invitation') ?? '';
    const { target, cookie } = await startLogin(settings);
    const response = redirectTo(target);
    response.cookies.set(cookieName(settings, 'login'), cookie, cookieOptions(settings, loginDurationSeconds));
    // An invitation travels with the sign-in, never in the provider URL.
    if (/^[\w-]{43}$/.test(invitation)) {
      response.cookies.set(cookieName(settings, 'invitation'), invitation, cookieOptions(settings, loginDurationSeconds));
    }
    return response;
  } catch {
    return redirectTo(new URL('/connexion?statut=indisponible', settings.origin));
  }
}
