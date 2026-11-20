import type { NextRequest } from 'next/server';
import { cookieName, cookieOptions, iamSettings } from '@/lib/iam/settings';
import { revokeSession } from '@/lib/iam/sessions';
import { problem, redirectTo, unavailable } from '@/lib/server/responses';

const path = '/api/v1/auth/logout';

export async function POST(request: NextRequest) {
  const settings = iamSettings();
  if (!settings) return unavailable(path);
  if (request.headers.get('origin') !== settings.origin.origin) {
    return problem(403, 'Origine de la demande refusée', path);
  }
  const name = cookieName(settings, 'session');
  try {
    await revokeSession(settings, request.cookies.get(name)?.value);
  } catch {
    return redirectTo(new URL('/espace?statut=indisponible', settings.origin));
  }
  const response = redirectTo(new URL('/connexion?statut=deconnecte', settings.origin));
  response.cookies.set(name, '', cookieOptions(settings, 0));
  return response;
}
