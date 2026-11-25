import { NextResponse, type NextRequest } from 'next/server';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import { badgeExport, credAction, credContexts, credOverview, myDocuments } from '@/lib/credentials/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const options = { path: '/api/v1/cred', studio: '/administration/documents', denial: 'cred.access', label: 'cred', returns: ['/documents'] };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  let badge: object | null = null;
  const response = await studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource, id] = operation;
    if (resource === 'me' && operation.length === 1) return myDocuments(settings, actor);
    if (resource === 'scopes' && operation.length === 1) {
      const scopeId = query.get('scopeId');
      return scopeId ? credOverview(settings, actor, scopeId) : { scopes: await credContexts(settings, actor) };
    }
    if (resource === 'badges' && operation.length === 2) {
      badge = await badgeExport(settings, actor, id, settings.origin.origin);
      return {};
    }
    return null;
  });
  if (!badge) return response;
  return new NextResponse(JSON.stringify(badge, null, 2), { headers: { 'Content-Type': 'application/ld+json; charset=utf-8',
    'Content-Disposition': 'attachment; filename="badge.json"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    if (operation.length !== 1) throw new Problem(404, 'Opération inconnue');
    return credAction(settings, actor, operation[0], input, correlation);
  });
}
