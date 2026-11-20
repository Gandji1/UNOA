import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { cookieName, iamSettings, permissionFormat, scopeIdFormat } from '@/lib/iam/settings';
import { checkPermission } from '@/lib/iam/sessions';
import { privateJson, problem, unavailable } from '@/lib/server/responses';

export async function GET(request: NextRequest) {
  const path = '/api/v1/access/check';
  const settings = iamSettings();
  if (!settings) return unavailable(path);
  const { searchParams } = request.nextUrl;
  const scopeId = searchParams.get('scopeId') || '';
  const permission = searchParams.get('permission') || '';
  if (!scopeIdFormat.test(scopeId) || !permissionFormat.test(permission)) {
    return problem(400, 'Portée ou permission invalide', path);
  }

  const correlationId = randomUUID();
  try {
    const token = request.cookies.get(cookieName(settings, 'session'))?.value;
    const decision = await checkPermission(settings, token, permission, scopeId, correlationId);
    if (decision === 'allowed') return privateJson({ allowed: true });
    if (decision === 'anonymous') return problem(401, 'Session institutionnelle requise', path, correlationId);
    return problem(403, 'Accès refusé', path, correlationId);
  } catch {
    return unavailable(path);
  }
}
