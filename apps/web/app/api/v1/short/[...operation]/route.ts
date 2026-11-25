import { NextResponse, type NextRequest } from 'next/server';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import { enrollmentProgress, learnerAction, mySpace, participationCsv, shortAction, shortContexts, shortOverview } from '@/lib/short/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const options = { path: '/api/v1/short', studio: '/administration/formations-courtes', denial: 'short.access', label: 'short', returns: ['/formations-courtes'], repeated: ['courseIds'] };
const learner = ['enrol', 'withdraw', 'feedback', 'rpl'];

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  let file: string | null = null;
  const response = await studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource, id] = operation;
    if (resource === 'me' && operation.length === 1) return mySpace(settings, actor);
    if (resource === 'scopes' && operation.length === 1) {
      const scopeId = query.get('scopeId');
      return scopeId ? shortOverview(settings, actor, scopeId) : { scopes: await shortContexts(settings, actor) };
    }
    if (resource === 'enrollments' && operation.length === 2) return enrollmentProgress(settings, actor, id);
    if (resource === 'report' && operation.length === 1) {
      file = await participationCsv(settings, actor, query.get('scopeId') ?? '');
      return {};
    }
    return null;
  });
  if (file === null) return response;
  return new NextResponse(file, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="participation.csv"', 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    if (operation.length !== 1) throw new Problem(404, 'Opération inconnue');
    const [action] = operation;
    if (learner.includes(action)) return learnerAction(settings, actor, action, input, correlation);
    return shortAction(settings, actor, action, input, correlation);
  });
}
