import { NextResponse, type NextRequest } from 'next/server';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import { contactAction, contactExport, contactSettings, notificationContexts, notificationOverview, replayJob, templateAction } from '@/lib/notifications/admin';

type RouteContext = { params: Promise<{ operation: string[] }> };
const options = { path: '/api/v1/notifications', studio: '/administration/notifications', denial: 'not.access', label: 'not', returns: ['/espace'] };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  let exported: object | null = null;
  const response = await studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource, part] = operation;
    if (resource === 'scopes' && operation.length === 1) {
      const scopeId = query.get('scopeId');
      return scopeId ? notificationOverview(settings, actor, scopeId) : { scopes: await notificationContexts(settings, actor) };
    }
    if (resource === 'contact' && operation.length === 1) return contactSettings(settings, actor);
    if (resource === 'contact' && part === 'export') return exported = await contactExport(settings, actor);
    return null;
  });
  if (!exported) return response;
  return new NextResponse(JSON.stringify(exported, null, 2), { headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="consentements-unoa.json"', 'Cache-Control': 'no-store',
  } });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    const [action] = operation;
    if (operation.length !== 1) throw new Problem(404, 'Opération inconnue');
    if (['templates', 'publish', 'retire'].includes(action)) return templateAction(settings, actor, action, input, correlation);
    if (action === 'replay') return replayJob(settings, actor, input, correlation);
    if (['contact', 'consent', 'preference'].includes(action)) return contactAction(settings, actor, action, input, correlation);
    throw new Problem(404, 'Opération inconnue');
  });
}
