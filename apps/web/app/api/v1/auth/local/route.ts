import { openAccount } from '@/lib/iam/accounts';
import type { NextRequest } from 'next/server';
import { cookieName, cookieOptions, iamSettings } from '@/lib/iam/settings';
import { localLogin } from '@/lib/iam/local';
import { problem, redirectTo, unavailable } from '@/lib/server/responses';

const path = '/api/v1/auth/local';
const statuses = { credentials: 'refuse', locked: 'verrouille', code: 'code' } as const;

export async function POST(request: NextRequest) {
  const settings = iamSettings();
  if (!settings) return unavailable(path);
  if (request.headers.get('origin') !== settings.origin.origin) return problem(403, 'Origine de la demande refusée', path);
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return problem(415, 'Format non pris en charge', path);
  const form = new URLSearchParams((await request.text()).slice(0, 2048));
  try {
    const outcome = await localLogin(settings, form.get('login'), form.get('password'), form.get('code'));
    if ('refused' in outcome) return redirectTo(new URL('/connexion?statut=' + statuses[outcome.refused], settings.origin));
    const response = redirectTo(new URL(outcome.mustChange ? '/espace?changer=1#mot-de-passe' : '/espace', settings.origin));
    openAccount(response, settings, outcome.token, [request.cookies.get(cookieName(settings, 'session'))?.value, request.cookies.get(cookieName(settings, 'accounts'))?.value].filter(Boolean).join('.'));
    return response;
  } catch {
    return redirectTo(new URL('/connexion?statut=indisponible', settings.origin));
  }
}
