import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { Problem, ensure } from '@/lib/shared/validation';
import { cookieName, iamSettings } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { privateJson, problem, redirectTo, unavailable } from '@/lib/server/responses';
import { storageError } from '@/lib/server/request';
import { auditDenial } from '@/lib/server/db';
import { studioGet, studioPost } from '@/lib/server/route';
import { changeSession, joinSession, scheduleSession, sessionRoster } from '@/lib/live/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const path = '/api/v1/live';
const options = { path, studio: '/apprendre', denial: 'live.access', label: 'live' };
const actions = ['consent', 'reschedule', 'cancel', 'recording', 'replay', 'resources', 'attendance'];

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioGet(request, operation, options, async ({ settings, actor }) => {
    const [resource, id, action] = operation;
    if (resource === 'sessions' && action === 'attendance') return sessionRoster(settings, actor, id);
    return null;
  });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  const [resource, id, action] = operation;
  if (resource === 'sessions' && action === 'join' && operation.length === 3) return join(request, id);
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    if (resource === 'offerings' && action === 'sessions') return scheduleSession(settings, actor, id, input, correlation);
    if (resource === 'sessions' && actions.includes(action)) return changeSession(settings, actor, id, action, input, correlation);
    throw new Problem(404, 'Opération inconnue');
  });
}

// Joining redirects a browser straight to the provider, or returns the URL to an API client.
async function join(request: NextRequest, id: string) {
  const settings = iamSettings();
  if (!settings) return unavailable(path);
  if (request.headers.get('origin') !== settings.origin.origin) return problem(403, 'Origine de la demande refusée', path);
  const correlation = randomUUID();
  const browser = request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded');
  let actor: string | null = null;
  try {
    actor = await sessionAccount(settings, request.cookies.get(cookieName(settings, 'session'))?.value);
    ensure(actor, 401, 'Session institutionnelle requise');
    const url = await joinSession(settings, actor, id, correlation);
    return browser ? NextResponse.redirect(url, { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
      : privateJson({ url });
  } catch (error) {
    const outcome = storageError(error, 'unoa-live-storage', 'Service temporairement indisponible');
    if (actor && outcome.status === 403) await auditDenial(settings, actor, 'live.access', correlation).catch(() => console.error('unoa-denial-audit'));
    if (!browser || outcome.status === 401) return problem(outcome.status, outcome.message, path, correlation);
    const back = new URL('/apprendre', settings.origin);
    back.searchParams.set('error', String(outcome.status));
    return redirectTo(back);
  }
}
