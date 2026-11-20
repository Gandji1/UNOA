import type { NextRequest } from 'next/server';
import { Problem, uuid } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import {
  appoint, createPosition, decideChange, decideUnit, endAppointment, orgContexts, orgDetails,
  proposeUnit, recordCapacity, requestChange, updateUnit,
} from '@/lib/org/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const options = { path: '/api/v1/org', studio: '/administration/structures', denial: 'org.access', label: 'org' };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const route = operation.join('/');
    if (route === 'units' && !query.get('scopeId')) return { scopes: await orgContexts(settings, actor) };
    if (route === 'units') return orgDetails(settings, actor, uuid(query.get('scopeId')));
    return null;
  });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    const [resource, id, action] = operation;
    if (resource === 'units' && operation.length === 1) return proposeUnit(settings, actor, input, correlation);
    if (resource === 'units' && action === 'decide') return decideUnit(settings, actor, id, input, correlation);
    if (resource === 'units' && action === 'update') return updateUnit(settings, actor, id, input, correlation);
    if (resource === 'units' && action === 'positions') return createPosition(settings, actor, id, input, correlation);
    if (resource === 'units' && action === 'capacities') return recordCapacity(settings, actor, id, input, correlation);
    if (resource === 'units' && action === 'reorganize') return requestChange(settings, actor, id, input, correlation);
    if (resource === 'positions' && action === 'appointments') return appoint(settings, actor, id, input, correlation);
    if (resource === 'appointments' && action === 'end') return endAppointment(settings, actor, id, input, correlation);
    if (resource === 'changes' && action === 'decide') return decideChange(settings, actor, id, input, correlation);
    throw new Problem(404, 'Opération inconnue');
  });
}
