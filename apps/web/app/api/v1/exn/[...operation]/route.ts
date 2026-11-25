import { NextResponse, type NextRequest } from 'next/server';
import { documentFormats } from '@unoa/domain/forms';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import { declarantAction, deposit, evidenceFile, exnContexts, exnOverview, mySpace, staffAction, verify } from '@/lib/external/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const options = {
  path: '/api/v1/exn', studio: '/administration/examens-nationaux', denial: 'exn.access', label: 'exn', returns: ['/examens-nationaux'], multipart: 6 * 1024 * 1024,
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  let file: { body: Uint8Array; type: string; name: string } | null = null;
  const response = await studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource, id] = operation;
    if (resource === 'me' && operation.length === 1) return { declarations: await mySpace(settings, actor) };
    if (resource === 'scopes' && operation.length === 1) {
      const scopeId = query.get('scopeId');
      return scopeId ? exnOverview(settings, actor, scopeId) : { scopes: await exnContexts(settings, actor) };
    }
    if ((resource === 'evidence' || resource === 'proofs') && operation.length === 2) {
      const found = await evidenceFile(settings, actor, id, resource === 'proofs');
      file = { body: new Uint8Array(found.content), type: documentFormats[found.format]?.mime ?? 'application/octet-stream', name: found.filename.replace(/[^\w.\-]/g, '_') };
      return {};
    }
    return null;
  });
  if (!file) return response;
  const found = file as { body: Uint8Array; type: string; name: string };
  return new NextResponse(found.body as BodyInit, { headers: { 'Content-Type': found.type, 'Content-Disposition': `attachment; filename="${found.name}"`,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" } });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    const [action] = operation;
    if (operation.length !== 1) throw new Problem(404, 'Opération inconnue');
    if (action === 'exams' || action === 'publish' || action === 'archive') return staffAction(settings, actor, action, input, correlation);
    if (action === 'verify') return verify(settings, actor, input, correlation);
    if (action === 'declare' || action === 'withdraw') return declarantAction(settings, actor, action, input, correlation);
    if (action === 'evidence') return deposit(settings, actor, input, correlation);
    throw new Problem(404, 'Opération inconnue');
  });
}
