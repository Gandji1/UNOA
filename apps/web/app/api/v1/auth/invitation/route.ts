import type { NextRequest } from 'next/server';
import { cookieName, cookieOptions, iamSettings, sessionDurationSeconds } from '@/lib/iam/settings';
import { acceptInvitationLocally } from '@/lib/iam/local';
import { Problem } from '@/lib/shared/validation';
import { problem, redirectTo, unavailable } from '@/lib/server/responses';

const path = '/api/v1/auth/invitation';

// Invitation form: the invited person chooses an identifier and a password.
export async function POST(request: NextRequest) {
  const settings = iamSettings();
  if (!settings) return unavailable(path);
  if (request.headers.get('origin') !== settings.origin.origin) return problem(403, 'Origine de la demande refusée', path);
  const form = new URLSearchParams((await request.text()).slice(0, 4096));
  const token = form.get('invitation') ?? '';
  const back = (code: number) => redirectTo(new URL(`/invitation/${encodeURIComponent(token)}?erreur=${code}`, settings.origin));
  if (form.get('password') !== form.get('confirm')) return back(422);
  try {
    const session = await acceptInvitationLocally(settings, token, form.get('login'), form.get('password'));
    const response = redirectTo(new URL('/espace?bienvenue=1', settings.origin));
    response.cookies.set(cookieName(settings, 'session'), session, cookieOptions(settings, sessionDurationSeconds));
    return response;
  } catch (error) {
    return back(error instanceof Problem ? error.status : 503);
  }
}
