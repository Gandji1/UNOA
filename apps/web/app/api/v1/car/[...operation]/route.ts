import { NextResponse, type NextRequest } from 'next/server';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import { applicationDetail, applicationDocument, careerAction, careerExport, careerSpace, cvFile, jobsOverview, opportunityDetail, recruitingSpace, referential, sharedProfile } from '@/lib/careers/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const options = { path: '/api/v1/car', studio: '/administration/entreprises', denial: 'car.access', label: 'car', returns: ['/carriere', '/offres', '/entreprise'],
  repeated: ['competencies', 'requiredDocuments'], multipart: 31 * 1024 * 1024 };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  let file: { body: Uint8Array; name: string; type: string } | null = null;
  const response = await studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource, id] = operation;
    if (operation.length === 1) {
      if (resource === 'me') return careerSpace(settings, actor);
      if (resource === 'export') return careerExport(settings, actor);
      if (resource === 'recruiting') return recruitingSpace(settings, actor);
      if (resource === 'referential') return referential(settings, actor);
      if (resource === 'scopes') return jobsOverview(settings, actor, query.get('scopeId') ?? '');
    }
    if (operation.length === 2) {
      if (resource === 'opportunities') return opportunityDetail(settings, id, actor);
      if (resource === 'applications') return applicationDetail(settings, actor, id);
      if (resource === 'profiles') return sharedProfile(settings, actor, id, query.get('companyId') ?? '');
      if (resource === 'cvs') {
        const cv = await cvFile(settings, actor, id);
        file = { body: new Uint8Array(cv.pdf), name: `cv-v${cv.version}.pdf`, type: 'application/pdf' };
        return {};
      }
      if (resource === 'documents') {
        const document = await applicationDocument(settings, actor, id);
        const extension = document.filename.toLowerCase().split('.').pop();
        file = { body: new Uint8Array(document.content), name: document.filename.replace(/[^\w.\-]/g, '_'), type: extension === 'png' ? 'image/png' : extension === 'pdf' ? 'application/pdf' : 'image/jpeg' };
        return {};
      }
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
    return careerAction(settings, actor, operation[0], input, correlation);
  });
}
