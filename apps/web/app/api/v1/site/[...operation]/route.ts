import type { NextRequest } from 'next/server';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost, type StudioOptions } from '@/lib/server/route';
import { createSite, siteAction, siteContexts, siteDetails } from '@/lib/site/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const options: StudioOptions = { path: '/api/v1/site', studio: '/administration/site', denial: 'site.access', label: 'site' };
const actions = ['hosts', 'texts', 'publish', 'online'];

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioGet(request, operation, options, async ({ settings, actor }, query) => {
    if (operation.join('/') !== 'scopes') return null;
    const scopeId = query.get('scopeId');
    return scopeId ? siteDetails(settings, actor, scopeId) : { scopes: await siteContexts(settings, actor) };
  });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    const [resource, id, action] = operation;
    if (resource === 'sites' && operation.length === 1) return createSite(settings, actor, input, correlation);
    if (resource === 'sites' && actions.includes(action)) return siteAction(settings, actor, id, action, input, correlation);
    throw new Problem(404, 'Opération inconnue');
  });
}
