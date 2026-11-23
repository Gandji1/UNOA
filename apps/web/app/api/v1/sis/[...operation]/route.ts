import { NextResponse, type NextRequest } from 'next/server';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import { myStudentRecords, sisAction, sisContexts, sisOverview, studentExport, studentRecord } from '@/lib/students/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const actions = ['rule', 'cohorts', 'groups', 'close-cohort', 'enrol', 'register', 'validate', 'cancel', 'units', 'suspend', 'resume', 'interrupt', 'withdraw', 'graduate'];
const options = {
  path: '/api/v1/sis', studio: '/administration/scolarite', denial: 'sis.access', label: 'sis', returns: ['/etudiant'],
  view: (input: Record<string, unknown>, result: Record<string, unknown> | null) => {
    const view: Record<string, string> = {};
    const institution = String(result?.institutionId ?? input.institutionId ?? '');
    if (/^[0-9a-f-]{36}$/.test(institution)) view.etablissement = institution;
    return view;
  },
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  let file: object | null = null;
  const response = await studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource, id, part] = operation;
    if (resource === 'institutions' && operation.length === 1) {
      const institutionId = query.get('institutionId');
      return institutionId ? sisOverview(settings, actor, institutionId, query.get('q') ?? undefined) : { institutions: await sisContexts(settings, actor) };
    }
    if (resource === 'me') return { records: await myStudentRecords(settings, actor) };
    if (resource === 'students' && operation.length === 2) return studentRecord(settings, actor, id);
    if (resource === 'students' && part === 'export') return file = await studentExport(settings, actor, id);
    return null;
  });
  if (!file) return response;
  return new NextResponse(JSON.stringify(file, null, 2), { headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="dossier-etudiant.json"', 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    if (operation.length !== 1 || !actions.includes(operation[0])) throw new Problem(404, 'Opération inconnue');
    return sisAction(settings, actor, operation[0], input, correlation);
  });
}
