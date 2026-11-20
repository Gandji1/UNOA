import type { NextRequest } from 'next/server';
import { Problem, uuid } from '@/lib/shared/validation';
import { studioGet, studioPost, type StudioOptions } from '@/lib/server/route';
import {
  attachTerritory, closeAttachment, createScopeType, createTerritory, readableTerritories, scopeTypeCatalogue,
  setTerritoryLabel, territoryDetails, updateTerritory,
} from '@/lib/territory/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const options: StudioOptions = {
  path: '/api/v1/territories', studio: '/administration/territoires', denial: 'territory.access', label: 'territory',
  repeated: ['parentTypes'],
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const route = operation.join('/');
    if (route === 'types') return { types: await scopeTypeCatalogue(settings) };
    if (route !== 'scopes') return null;
    const scopeId = query.get('scopeId');
    const after = query.get('after');
    if (scopeId) return territoryDetails(settings, actor, uuid(scopeId), after ? uuid(after) : undefined);
    const scopes = await readableTerritories(settings, actor, after ? uuid(after) : undefined);
    return { scopes: scopes.slice(0, 50), next: scopes.length > 50 ? scopes[49].id : null };
  });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    const [resource, id, action] = operation;
    if (resource === 'types' && operation.length === 1) return createScopeType(settings, actor, input, correlation);
    if (resource === 'scopes' && operation.length === 1) return createTerritory(settings, actor, input, correlation);
    if (resource === 'scopes' && action === 'update') return updateTerritory(settings, actor, id, input, correlation);
    if (resource === 'scopes' && action === 'labels') return setTerritoryLabel(settings, actor, id, input, correlation);
    if (resource === 'scopes' && action === 'attachments') return attachTerritory(settings, actor, id, input, correlation);
    if (resource === 'attachments' && action === 'close') return closeAttachment(settings, actor, id, input, correlation);
    throw new Problem(404, 'Opération inconnue');
  });
}
