import { NextResponse, type NextRequest } from 'next/server';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import { draftFile, mySpace, projectDetails, thesisAction, thesisContexts, thesisOverview, uploadDraft } from '@/lib/theses/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const options = { path: '/api/v1/thesis', studio: '/administration/memoires', denial: 'thesis.access', label: 'thesis', returns: ['/memoires'], repeated: ['present'], multipart: 21 * 1024 * 1024 };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  let file: { body: Uint8Array; name: string } | null = null;
  const response = await studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource, id] = operation;
    if (resource === 'me' && operation.length === 1) return mySpace(settings, actor);
    if (resource === 'scopes' && operation.length === 1) {
      const scopeId = query.get('scopeId');
      return scopeId ? thesisOverview(settings, actor, scopeId) : { scopes: await thesisContexts(settings, actor) };
    }
    if (resource === 'projects' && operation.length === 2) return projectDetails(settings, actor, id);
    if (resource === 'drafts' && operation.length === 2) {
      const draft = await draftFile(settings, actor, id);
      file = { body: new Uint8Array(draft.content), name: draft.filename.replace(/[^\w.\-]/g, '_') };
      return {};
    }
    return null;
  });
  if (!file) return response;
  const found = file as { body: Uint8Array; name: string };
  return new NextResponse(found.body as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${found.name}"`,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" } });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    if (operation.length !== 1) throw new Problem(404, 'Opération inconnue');
    if (operation[0] === 'drafts') return uploadDraft(settings, actor, input, correlation);
    return thesisAction(settings, actor, operation[0], input, correlation);
  });
}
