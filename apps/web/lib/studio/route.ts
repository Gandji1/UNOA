import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { cookieName, iamSettings, type IamSettings } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { privateJson, problem, redirectTo, unavailable } from '@/lib/iam/responses';
import { requireConfig, type Input } from '@/lib/config/validation';
import { readInput, storageError } from '@/lib/studio/requests';
import { auditDenial } from '@/lib/studio/db';

export interface StudioCall {
  settings: IamSettings;
  actor: string;
  operation: string[];
  correlation: string;
}

interface Options {
  path: string;
  studio: string;
  denial: string;
  label: string;
  repeated?: string[];
}

function failure(error: unknown, options: Options) {
  return storageError(error, 'unoa-' + options.label + '-storage', 'Service temporairement indisponible');
}

// A browser form names the studio view it returns to; only studio paths are accepted.
function returnPath(input: Input, studio: string) {
  const target = typeof input.return === 'string' ? input.return : '';
  return target.startsWith(studio) && !target.includes('//') && !/[\r\n\\]/.test(target) ? target : studio;
}

export async function studioGet(
  request: NextRequest, operation: string[], options: Options,
  handle: (call: StudioCall, query: URLSearchParams) => Promise<object | null>,
) {
  const settings = iamSettings();
  if (!settings) return unavailable(options.path);
  const correlation = randomUUID();
  let actor: string | null = null;
  try {
    actor = await sessionAccount(settings, request.cookies.get(cookieName(settings, 'session'))?.value);
    requireConfig(actor, 401, 'Session institutionnelle requise');
    const body = await handle({ settings, actor, operation, correlation }, request.nextUrl.searchParams);
    return body ? privateJson(body) : problem(404, 'Opération inconnue', options.path, correlation);
  } catch (error) {
    const outcome = failure(error, options);
    if (actor && outcome.status === 403) {
      await auditDenial(settings, actor, options.denial, correlation).catch(() => console.error('unoa-denial-audit'));
    }
    return problem(outcome.status, outcome.message, options.path, correlation);
  }
}

export async function studioPost(
  request: NextRequest, operation: string[], options: Options,
  handle: (call: StudioCall, input: Input) => Promise<object>,
) {
  const settings = iamSettings();
  if (!settings) return unavailable(options.path);
  if (request.headers.get('origin') !== settings.origin.origin) {
    return problem(403, 'Origine de la demande refusée', options.path);
  }
  const correlation = randomUUID();
  const type = request.headers.get('content-type')?.split(';', 1)[0].trim();
  const form = type === 'application/x-www-form-urlencoded';
  let actor: string | null = null;
  let back = options.studio;
  try {
    actor = await sessionAccount(settings, request.cookies.get(cookieName(settings, 'session'))?.value);
    requireConfig(actor, 401, 'Session institutionnelle requise');
    requireConfig(form || type === 'application/json', 415, 'Format de requête non pris en charge');
    const input = await readInput(request, form, options.repeated);
    if (form) back = returnPath(input, options.studio);
    const result = await handle({ settings, actor, operation, correlation }, input);
    if (!form) return privateJson(result);
    const url = new URL(back, settings.origin);
    url.searchParams.delete('error');
    url.searchParams.set('message', 'saved');
    return redirectTo(url);
  } catch (error) {
    const outcome = failure(error, options);
    if (actor && outcome.status === 403) {
      await auditDenial(settings, actor, options.denial, correlation).catch(() => console.error('unoa-denial-audit'));
    }
    if (!form || outcome.status === 401) return problem(outcome.status, outcome.message, options.path, correlation);
    const url = new URL(back, settings.origin);
    url.searchParams.delete('message');
    url.searchParams.set('error', String(outcome.status));
    return redirectTo(url);
  }
}
