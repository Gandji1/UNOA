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
    const { target, cookie } = await startLogin(settings);
    const response = redirectTo(target);
    response.cookies.set(cookieName(settings, 'login'), cookie, cookieOptions(settings, loginDurationSeconds));
    return response;
  } catch {
    return redirectTo(new URL('/connexion?statut=indisponible', settings.origin));
  }
}
