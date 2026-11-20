import type { NextRequest } from 'next/server';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import {
  admissionsContexts, admissionsOverview, applicantAction, applicationView, createRound, myApplications, roundAction,
  roundDetails, staffAction, startApplication, uploadDocument,
} from '@/lib/admissions/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const options = {
  path: '/api/v1/admissions', studio: '/administration/admissions', denial: 'adm.access', label: 'adm',
  returns: ['/candidature'], multipart: 6 * 1024 * 1024,
};
const applicantActions = ['answers', 'submit', 'withdraw', 'accept', 'decline', 'appeal'];
const staffActions = ['document', 'request', 'review', 'interview', 'decide', 'rule'];

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource, id] = operation;
    if (resource === 'scopes' && operation.length === 1) {
      const scopeId = query.get('scopeId');
      return scopeId ? admissionsOverview(settings, actor, scopeId) : { scopes: await admissionsContexts(settings, actor) };
    }
    if (resource === 'rounds' && operation.length === 2) return roundDetails(settings, actor, id, query.get('state') ?? undefined);
    if (resource === 'applications' && operation.length === 1) return { applications: await myApplications(settings, actor) };
    if (resource === 'applications' && operation.length === 2) {
      const { round, application, documents, requests, interviews, decisions, appeals, reviews, revisions, completeness, staff } =
        await applicationView(settings, actor, id);
      return { round, application, documents, requests, interviews, decisions, appeals, reviews, revisions, completeness, staff };
    }
    return null;
  });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    const [resource, id, action] = operation;
    if (resource === 'rounds' && operation.length === 1) return createRound(settings, actor, input, correlation);
    if (resource === 'rounds' && (action === 'open' || action === 'close')) return roundAction(settings, actor, id, action, correlation);
    if (resource === 'rounds' && action === 'apply') return startApplication(settings, actor, id, correlation);
    if (resource === 'applications' && action === 'documents') {
      const file = input.file;
      if (!(file instanceof File)) throw new Problem(400, 'Fichier requis');
      return uploadDocument(settings, actor, id, String(input.key ?? ''), file, correlation);
    }
    if (resource === 'applications' && applicantActions.includes(action)) {
      return applicantAction(settings, actor, id, action, input, correlation);
    }
    if (resource === 'applications' && staffActions.includes(action)) return staffAction(settings, actor, id, action, input, correlation);
    throw new Problem(404, 'Opération inconnue');
  });
}
