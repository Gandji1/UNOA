import { NextResponse, type NextRequest } from 'next/server';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import { internshipAction, internshipContexts, internshipDetails, internshipSpace, internshipsOverview, reportFile, uploadReport } from '@/lib/internships/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const options = { path: '/api/v1/stg', studio: '/administration/stages', denial: 'stg.access', label: 'stg', returns: ['/stages', '/entreprise'], multipart: 21 * 1024 * 1024 };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  let file: { body: Uint8Array; name: string } | null = null;
  const response = await studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource, id] = operation;
    if (resource === 'me' && operation.length === 1) return internshipSpace(settings, actor);
    if (resource === 'scopes' && operation.length === 1) {
      const scopeId = query.get('scopeId');
      return scopeId ? internshipsOverview(settings, actor, scopeId) : { scopes: await internshipContexts(settings, actor) };
    }
    if (resource === 'internships' && operation.length === 2) return internshipDetails(settings, actor, id);
    if (resource === 'reports' && operation.length === 2) {
      const report = await reportFile(settings, actor, id);
      file = { body: new Uint8Array(report.content), name: report.filename.replace(/[^\w.\-]/g, '_') };
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
    if (operation[0] === 'reports') return uploadReport(settings, actor, input, correlation);
    return internshipAction(settings, actor, operation[0], input, correlation);
  });
}
