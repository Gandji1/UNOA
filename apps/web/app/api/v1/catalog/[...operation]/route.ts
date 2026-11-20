import type { NextRequest } from 'next/server';
import { ConfigProblem, uuid } from '@/lib/config/validation';
import { studioGet, studioPost } from '@/lib/studio/route';
import {
  archiveField, catalogContexts, catalogOverview, createCompetency, createCourse, createField, createProgram,
  defineFieldType, defineProgramKind, editVersion, programDetails, recordAuthorization, removeFromVersion,
  setProgramLabel, simulateVersion, transitionVersion, verifyAuthorization, versionDetails,
} from '@/lib/catalog/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const options = {
  path: '/api/v1/catalog', studio: '/administration/catalogue', denial: 'catalog.access', label: 'catalog',
  repeated: ['parentTypes', 'languages', 'choices'],
};
const versionParts = ['update', 'periods', 'groups', 'units', 'volumes', 'courses', 'prerequisites',
  'competencies', 'requirements', 'territories', 'equivalences'];
const transitions = ['submit', 'review', 'publish', 'admission', 'derive'];

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource, id] = operation;
    if (resource === 'scopes' && operation.length === 1) {
      const scopeId = query.get('scopeId');
      return scopeId ? catalogOverview(settings, actor, uuid(scopeId)) : { scopes: await catalogContexts(settings, actor) };
    }
    if (resource === 'programs' && operation.length === 2) return programDetails(settings, actor, id);
    if (resource === 'program-versions' && operation.length === 2) return versionDetails(settings, actor, id);
    return null;
  });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    const [resource, id, action] = operation;
    const single = operation.length === 1;
    if (resource === 'field-types' && single) return defineFieldType(settings, actor, input, correlation);
    if (resource === 'program-kinds' && single) return defineProgramKind(settings, actor, input, correlation);
    if (resource === 'fields' && single) return createField(settings, actor, input, correlation);
    if (resource === 'fields' && action === 'archive') return archiveField(settings, actor, id, input, correlation);
    if (resource === 'courses' && single) return createCourse(settings, actor, input, correlation);
    if (resource === 'competencies' && single) return createCompetency(settings, actor, input, correlation);
    if (resource === 'programs' && single) return createProgram(settings, actor, input, correlation);
    if (resource === 'programs' && action === 'labels') return setProgramLabel(settings, actor, id, input, correlation);
    if (resource === 'programs' && action === 'authorizations') return recordAuthorization(settings, actor, id, input, correlation);
    if (resource === 'authorizations' && action === 'verify') return verifyAuthorization(settings, actor, id, input, correlation);
    if (resource === 'program-versions' && operation.length === 3) {
      if (versionParts.includes(action)) return editVersion(settings, actor, id, action, input, correlation);
      if (action === 'remove') return removeFromVersion(settings, actor, id, input, correlation);
      if (action === 'simulate') return simulateVersion(settings, actor, id, input);
      if (transitions.includes(action)) return transitionVersion(settings, actor, id, action, input, correlation);
    }
    throw new ConfigProblem(404, 'Opération inconnue');
  });
}
