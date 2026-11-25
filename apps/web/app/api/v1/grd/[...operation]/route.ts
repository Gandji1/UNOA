import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import {
  gradeHistory, gradeSheet, grdAction, grdContexts, grdOverview, invariants, issueTranscript, juryDetails, myResults, verifyTranscript,
} from '@/lib/grades/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const id = /^[0-9a-f-]{36}$/;
const options = {
  path: '/api/v1/grd', studio: '/administration/notes', denial: 'grd.access', label: 'grd', returns: ['/resultats'], repeated: ['present'],
  view: (input: Record<string, unknown>, result: Record<string, unknown> | null) => {
    const scope = String(result?.scopeId ?? input.scopeId ?? '');
    return id.test(scope) ? { scope } : {} as Record<string, string>;
  },
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  let file: string | null = null;
  let type = 'text/plain; charset=utf-8';
  let name = 'proces-verbal.txt';
  const response = await studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource, key] = operation;
    if (resource === 'me' && operation.length === 1) return myResults(settings, actor);
    if (resource === 'scopes' && operation.length === 1) {
      const scopeId = query.get('scopeId');
      return scopeId ? grdOverview(settings, actor, scopeId) : { scopes: await grdContexts(settings, actor) };
    }
    if (resource === 'sheet' && operation.length === 1) return gradeSheet(settings, actor, query.get('cohortId') ?? '', query.get('periodId') ?? '');
    if (resource === 'history' && operation.length === 1) return { entries: await gradeHistory(settings, actor, query.get('registrationId') ?? '', query.get('unitId') ?? '') };
    if (resource === 'juries' && operation.length === 2) return juryDetails(settings, actor, key);
    if (resource === 'invariants' && operation.length === 1) return { anomalies: await invariants(settings, actor, query.get('scopeId') ?? '') };
    if (resource === 'transcripts' && operation.length === 2) return verifyTranscript(settings, actor, key);
    // Download of a sealed transcript: each issue is recorded (append-only).
    if (resource === 'transcript' && operation.length === 1) {
      file = JSON.stringify(await issueTranscript(settings, actor, { studentId: query.get('studentId') ?? undefined }, randomUUID()), null, 2);
      type = 'application/json; charset=utf-8'; name = 'releve-de-notes.json';
      return {};
    }
    if (resource === 'jury-minutes' && operation.length === 2) {
      const details = await juryDetails(settings, actor, key);
      if (!details.jury.minutes) throw new Problem(409, 'Procès-verbal non établi');
      file = [details.jury.minutes, '', `Empreinte SHA-256 : ${details.jury.minutes_sha256}`, 'Signatures :',
        ...details.signatures.map(item => `- ${item.name ?? item.account_id} · ${new Date(item.signed_at).toISOString()} · ${item.sha256}${item.rectification_id ? ' (avenant)' : ''}`),
        ...details.rectifications.map(item => `Avenant ${new Date(item.created_at).toISOString()} — ${item.name ?? ''} : ${item.reason}`)].join('\n');
      return {};
    }
    return null;
  });
  if (file === null) return response;
  return new NextResponse(file, { headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"`,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    const [action] = operation;
    if (operation.length !== 1) throw new Problem(404, 'Opération inconnue');
    if (action === 'transcript') return issueTranscript(settings, actor, input, correlation);
    return grdAction(settings, actor, action, input, correlation);
  });
}
