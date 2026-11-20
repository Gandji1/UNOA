import type { NextRequest } from 'next/server';
import { scopeIdFormat } from '@/lib/iam/settings';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import { accessAction, accessOverview, accountDetails, adminContexts, auditTrail, roleCatalogue } from '@/lib/iam/admin';

type RouteContext = { params: Promise<{ operation: string[] }> };
const actions = ['roles', 'archive-role', 'grants', 'revoke', 'delegate', 'invitations', 'revoke-invitation', 'disable', 'enable', 'sessions', 'profile'];
const options = {
  path: '/api/v1/iam', studio: '/administration/acces', denial: 'iam.access', label: 'iam', returns: ['/espace', '/connexion'],
  repeated: ['permissions'],
  // Without an explicit return, a form comes back to the scope, with the invitation link shown once.
  view: (input: Record<string, unknown>, result: Record<string, unknown> | null) => {
    const view: Record<string, string> = {};
    const scope = String(result?.scopeId ?? input.scopeId ?? '');
    if (scopeIdFormat.test(scope)) view.scope = scope;
    if (typeof result?.link === 'string') view.lien = result.link;
    return view;
  },
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource, id] = operation;
    if (resource === 'scopes' && operation.length === 1) {
      const scopeId = query.get('scopeId');
      return scopeId ? accessOverview(settings, actor, scopeId, query.get('q') ?? undefined) : { scopes: await adminContexts(settings, actor) };
    }
    if (resource === 'roles' && operation.length === 1) return roleCatalogue(settings, actor);
    if (resource === 'accounts' && operation.length === 2) return accountDetails(settings, actor, id);
    if (resource === 'audit' && operation.length === 1) {
      return auditTrail(settings, actor, query.get('scopeId') ?? '', query.get('prefix') ?? undefined, query.get('before') ?? undefined);
    }
    return null;
  });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    const [action] = operation;
    if (operation.length !== 1 || !actions.includes(action)) throw new Problem(404, 'Opération inconnue');
    return accessAction(settings, actor, action, input, correlation);
  });
}
