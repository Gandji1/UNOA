import type { NextRequest } from 'next/server';
import { cookieName, iamSettings } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { privateJson, problem, unavailable } from '@/lib/iam/responses';

export async function GET(request: NextRequest) {
  const path = '/api/v1/me';
  const settings = iamSettings();
  if (!settings) return unavailable(path);
  try {
    const accountId = await sessionAccount(settings, request.cookies.get(cookieName(settings, 'session'))?.value);
    return accountId
      ? privateJson({ accountId })
      : problem(401, 'Session institutionnelle requise', path);
  } catch {
    return unavailable(path);
  }
}
