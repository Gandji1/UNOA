import { NextResponse, type NextRequest } from 'next/server';
import { documentFormats } from '@unoa/domain/forms';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import {
  candidateAction, contractSign, obligationDone, remunerationCsv, staffTeaAction, teaContexts, teacherApplicationDetails, teacherDocument,
  teacherSpace, teaOverview, uploadTeacherDocument,
} from '@/lib/teachers/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const candidate = ['profile', 'apply', 'proposal', 'submit', 'withdraw'];
const staff = ['openings', 'close-opening', 'verify', 'review', 'decide', 'contracts', 'sign', 'suspend', 'resume', 'end', 'renew', 'assign', 'obligations'];
const options = {
  path: '/api/v1/tea', studio: '/administration/enseignants', denial: 'tea.access', label: 'tea', returns: ['/enseignement'], multipart: 6 * 1024 * 1024,
  view: (input: Record<string, unknown>, result: Record<string, unknown> | null) => {
    const view: Record<string, string> = {};
    const application = String(result?.applicationId ?? input.applicationId ?? '');
    const scope = String(result?.scopeId ?? input.scopeId ?? '');
    if (/^[0-9a-f-]{36}$/.test(application)) view.candidature = application;
    else if (/^[0-9a-f-]{36}$/.test(scope)) view.scope = scope;
    return view;
  },
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  let file: { body: BodyInit; type: string; name: string } | null = null;
  const response = await studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource, id] = operation;
    if (resource === 'me') return teacherSpace(settings, actor);
    if (resource === 'scopes' && operation.length === 1) {
      const scopeId = query.get('scopeId');
      return scopeId ? teaOverview(settings, actor, scopeId) : { scopes: await teaContexts(settings, actor) };
    }
    if (resource === 'applications' && operation.length === 2) return teacherApplicationDetails(settings, actor, id);
    if (resource === 'remuneration') {
      file = { body: '﻿' + await remunerationCsv(settings, actor, query.get('scopeId') ?? ''), type: 'text/csv; charset=utf-8', name: 'remunerations.csv' };
      return {};
    }
    if (resource === 'documents' && operation.length === 2) {
      const found = await teacherDocument(settings, actor, id);
      file = { body: new Uint8Array(found.content), type: documentFormats[found.format]?.mime ?? 'application/octet-stream', name: found.filename.replace(/[^\w.\-]/g, '_') };
      return {};
    }
    return null;
  });
  if (!file) return response;
  const found = file as { body: BodyInit; type: string; name: string };
  return new NextResponse(found.body, { headers: { 'Content-Type': found.type, 'Content-Disposition': `attachment; filename="${found.name}"`,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" } });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    const [action] = operation;
    if (operation.length !== 1) throw new Problem(404, 'Opération inconnue');
    if (candidate.includes(action)) return candidateAction(settings, actor, action, input, correlation);
    if (action === 'documents') return uploadTeacherDocument(settings, actor, input, correlation);
    if (action === 'my-sign') return contractSign(settings, actor, String(input.contractId ?? ''), correlation);
    if (action === 'obligation-done') return obligationDone(settings, actor, String(input.obligationId ?? ''), correlation);
    if (staff.includes(action)) return staffTeaAction(settings, actor, action, input, correlation);
    throw new Problem(404, 'Opération inconnue');
  });
}
