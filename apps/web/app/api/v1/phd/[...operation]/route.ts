import type { NextRequest } from 'next/server';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import { doctoralSpace, phdAction, phdContexts, phdOverview } from '@/lib/doctorate/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const options = { path: '/api/v1/phd', studio: '/administration/doctorat', denial: 'phd.access', label: 'phd', returns: ['/doctorat'] };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource] = operation;
    if (resource === 'me' && operation.length === 1) return doctoralSpace(settings, actor);
    if (resource === 'scopes' && operation.length === 1) {
      const scopeId = query.get('scopeId');
      return scopeId ? phdOverview(settings, actor, scopeId) : { scopes: await phdContexts(settings, actor) };
    }
    return null;
  });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    if (operation.length !== 1) throw new Problem(404, 'Opération inconnue');
    return phdAction(settings, actor, operation[0], input, correlation);
  });
}
