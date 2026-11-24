import { NextResponse, type NextRequest } from 'next/server';
import { documentFormats } from '@unoa/domain/forms';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import {
  answerFile, assessmentArchive, authorAction, copyDetails, gradeAction, learnerAction, learnerSpace, offeringAssessments, uploadAnswerFile,
} from '@/lib/assessments/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const author = ['banks', 'questions', 'revise', 'retire', 'assessments', 'add-question', 'remove-question', 'publish', 'close', 'accommodations'];
const learner = ['start', 'save', 'submit', 'respond'];
const grading = ['grade', 'report', 'decide'];
const options = {
  path: '/api/v1/ass', studio: '/evaluations/gestion', denial: 'ass.access', label: 'ass', returns: ['/evaluations'], multipart: 6 * 1024 * 1024,
  view: (input: Record<string, unknown>, result: Record<string, unknown> | null) => {
    const offering = String(result?.offeringId ?? input.offeringId ?? '');
    return /^[0-9a-f-]{36}$/.test(offering) ? { offre: offering } : {} as Record<string, string>;
  },
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  let file: { body: BodyInit; type: string; name: string } | null = null;
  const response = await studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource, id] = operation;
    if (resource === 'me' && operation.length === 1) return learnerSpace(settings, actor);
    if (resource === 'offerings' && operation.length === 2) return offeringAssessments(settings, actor, id);
    if (resource === 'attempts' && operation.length === 2) return copyDetails(settings, actor, id);
    if (resource === 'archive' && operation.length === 2) {
      file = { body: await assessmentArchive(settings, actor, id), type: 'application/json; charset=utf-8', name: 'archive-evaluation-' + id.slice(0, 8) + '.json' };
      return {};
    }
    if (resource === 'files' && operation.length === 2) {
      const found = await answerFile(settings, actor, id);
      file = { body: new Uint8Array(found.content), type: documentFormats[found.format]?.mime ?? 'application/octet-stream', name: found.filename.replace(/[^\w.\-]/g, '_') };
      return {};
    }
    void query;
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
    if (author.includes(action)) return authorAction(settings, actor, action, input, correlation);
    if (learner.includes(action)) return learnerAction(settings, actor, action, input, correlation);
    if (grading.includes(action)) return gradeAction(settings, actor, action, input, correlation);
    if (action === 'files') return uploadAnswerFile(settings, actor, input, correlation);
    throw new Problem(404, 'Opération inconnue');
  });
}
