import type { NextRequest } from 'next/server';
import { cookieName, iamSettings } from '@/lib/iam/settings';
import { forgetAccount } from '@/lib/iam/accounts';
import { revokeSession } from '@/lib/iam/sessions';
import { problem, redirectTo, unavailable } from '@/lib/server/responses';

const path = '/api/v1/auth/logout';

// Closes the current account only; another open account takes over (ADR-0017).
export async function POST(request: NextRequest) {
  const settings = iamSettings();
  if (!settings) return unavailable(path);
  if (request.headers.get('origin') !== settings.origin.origin) {
    return problem(403, 'Origine de la demande refusée', path);
  }
  const token = request.cookies.get(cookieName(settings, 'session'))?.value;
  try {
    await revokeSession(settings, token);
  } catch {
    return redirectTo(new URL('/espace?statut=indisponible', settings.origin));
  }
  const response = redirectTo(new URL('/connexion?statut=deconnecte', settings.origin));
  if (forgetAccount(response, settings, token, request.cookies.get(cookieName(settings, 'accounts'))?.value)) {
    response.headers.set('location', new URL('/espace', settings.origin).toString());
  }
  return response;
}
