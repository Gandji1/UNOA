import { openAccount } from '@/lib/iam/accounts';
import type { NextRequest } from 'next/server';
import { cookieName, cookieOptions, iamSettings } from '@/lib/iam/settings';
import { registerLocally } from '@/lib/iam/local';
import { siteForRequest } from '@/lib/site/store';
import { Problem } from '@/lib/shared/validation';
import { problem, redirectTo, unavailable } from '@/lib/server/responses';

const path = '/api/v1/auth/register';

export async function POST(request: NextRequest) {
  const settings = iamSettings();
  if (!settings) return unavailable(path);
  if (request.headers.get('origin') !== settings.origin.origin) return problem(403, 'Origine de la demande refusée', path);
  const form = Object.fromEntries(new URLSearchParams((await request.text()).slice(0, 4096)));
  try {
    const site = await siteForRequest(request).catch(() => null);
    const session = await registerLocally(settings, site?.site_id ?? null, form);
    const response = redirectTo(new URL('/espace?bienvenue=1', settings.origin));
    openAccount(response, settings, session, [request.cookies.get(cookieName(settings, 'session'))?.value, request.cookies.get(cookieName(settings, 'accounts'))?.value].filter(Boolean).join('.'));
    return response;
  } catch (error) {
    return redirectTo(new URL('/inscription?erreur=' + (error instanceof Problem ? error.status : 503), settings.origin));
  }
}
