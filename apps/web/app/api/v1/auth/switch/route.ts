import type { NextRequest } from 'next/server';
import { cookieName, iamSettings } from '@/lib/iam/settings';
import { openAccount, openAccounts, remembered } from '@/lib/iam/accounts';
import { problem, redirectTo, unavailable } from '@/lib/server/responses';

const path = '/api/v1/auth/switch';

// Switches to another account already open in this browser (ADR-0017).
export async function POST(request: NextRequest) {
  const settings = iamSettings();
  if (!settings) return unavailable(path);
  if (request.headers.get('origin') !== settings.origin.origin) return problem(403, 'Origine de la demande refusée', path);
  const form = new URLSearchParams((await request.text()).slice(0, 256));
  const list = request.cookies.get(cookieName(settings, 'accounts'))?.value;
  const index = Number(form.get('compte'));
  const token = remembered(list)[index];
  try {
    const open = token ? await openAccounts(settings, list, undefined) : [];
    if (!open.some(item => item.index === index)) return redirectTo(new URL('/connexion?statut=expire', settings.origin));
  } catch {
    return redirectTo(new URL('/espace?statut=indisponible', settings.origin));
  }
  return openAccount(redirectTo(new URL('/espace', settings.origin)), settings, token, list);
}
