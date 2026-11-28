import { NextResponse, type NextRequest } from 'next/server';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import { companiesOverview, companyAction, companyContexts, companyDocument, companySpace, registerCompany, uploadCompanyDocument } from '@/lib/companies/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const options = { path: '/api/v1/ent', studio: '/administration/entreprises', denial: 'ent.access', label: 'ent', returns: ['/entreprise', '/entreprises'], multipart: 11 * 1024 * 1024 };
const types: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg' };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  let file: { body: Uint8Array; name: string; type: string } | null = null;
  const response = await studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource, id] = operation;
    if (resource === 'me' && operation.length === 1) return companySpace(settings, actor);
    if (resource === 'scopes' && operation.length === 1) {
      const scopeId = query.get('scopeId');
      return scopeId ? companiesOverview(settings, actor, scopeId) : { scopes: await companyContexts(settings, actor) };
    }
    if (resource === 'documents' && operation.length === 2) {
      const document = await companyDocument(settings, actor, id);
      file = { body: new Uint8Array(document.content), name: document.filename.replace(/[^\w.\-]/g, '_'), type: types[document.format] };
      return {};
    }
    return null;
  });
  if (!file) return response;
  const found = file as { body: Uint8Array; name: string; type: string };
  return new NextResponse(found.body as BodyInit, { headers: { 'Content-Type': found.type, 'Content-Disposition': `attachment; filename="${found.name}"`,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" } });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    if (operation.length !== 1) throw new Problem(404, 'Opération inconnue');
    if (operation[0] === 'register') return registerCompany(settings, actor, input, correlation);
    if (operation[0] === 'documents') return uploadCompanyDocument(settings, actor, input, correlation);
    return companyAction(settings, actor, operation[0], input, correlation);
  });
}
