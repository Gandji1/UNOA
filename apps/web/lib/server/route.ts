import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { cookieName, iamSettings, scopeIdFormat, type IamSettings } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { privateJson, problem, redirectTo, unavailable } from '@/lib/server/responses';
import { ensure, Problem, type Input } from '@/lib/shared/validation';
import { readInput, storageError } from '@/lib/server/request';
import { auditDenial } from '@/lib/server/db';

// One HTTP pipeline for every authenticated studio route:
// session → origin check (writes) → input size and format → module handler →
// JSON for API clients, or a 303 redirect with a status for browser forms.
// Every 403 is written to the audit trail under the module's denial action.

export interface StudioCall {
  settings: IamSettings;
  actor: string;
  operation: string[];
  correlation: string;
  form: boolean;
  request: NextRequest;
}

export interface StudioOptions {
  path: string;
  studio: string;
  denial: string;
  label: string;
  repeated?: string[];
  returns?: string[];
  // Maximum body size of a multipart upload; multipart is refused without it.
  multipart?: number;
  // Query of the studio view a form returns to when it names none.
  view?: (input: Input, result: Record<string, unknown> | null, operation: string[]) => Record<string, string>;
}

// Reads a body up to a fixed size, whatever the declared length.
async function readBody(request: NextRequest, limit: number) {
  const reader = request.body?.getReader();
  ensure(reader, 400, 'Corps de requête requis');
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Problem(413, 'Requête trop volumineuse');
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

function failure(error: unknown, options: StudioOptions) {
  return storageError(error, 'unoa-' + options.label + '-storage', 'Service temporairement indisponible');
}

// A browser form names the studio view it returns to; only known paths are accepted.
function returnPath(input: Input, studio: string, others: string[] = []) {
  const target = typeof input.return === 'string' ? input.return : '';
  const known = [studio, ...others].some(prefix => target === prefix || target.startsWith(prefix + '?') || target.startsWith(prefix + '/'));
  return known && !target.includes('//') && !/[\r\n\\]/.test(target) ? target : null;
}

const defaultView = (input: Input, result: Record<string, unknown> | null) => {
  const scope = String(result?.scopeId ?? input.scopeId ?? '');
  return scopeIdFormat.test(scope) ? { scope } : {} as Record<string, string>;
};

function back(settings: IamSettings, options: StudioOptions, input: Input | null, result: Record<string, unknown> | null, operation: string[]) {
  const explicit = input ? returnPath(input, options.studio, options.returns) : null;
  const url = new URL(explicit ?? options.studio, settings.origin);
  if (!explicit && input) {
    for (const [key, value] of Object.entries((options.view ?? defaultView)(input, result, operation))) url.searchParams.set(key, value);
  }
  url.searchParams.delete('error');
  url.searchParams.delete('message');
  return url;
}

export async function studioGet(
  request: NextRequest, operation: string[], options: StudioOptions,
  handle: (call: StudioCall, query: URLSearchParams) => Promise<object | null>,
) {
  const settings = iamSettings();
  if (!settings) return unavailable(options.path);
  const correlation = randomUUID();
  let actor: string | null = null;
  try {
    actor = await sessionAccount(settings, request.cookies.get(cookieName(settings, 'session'))?.value);
    ensure(actor, 401, 'Session institutionnelle requise');
    const body = await handle({ settings, actor, operation, correlation, form: false, request }, request.nextUrl.searchParams);
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
  request: NextRequest, operation: string[], options: StudioOptions,
  handle: (call: StudioCall, input: Input) => Promise<object>,
) {
  const settings = iamSettings();
  if (!settings) return unavailable(options.path);
  if (request.headers.get('origin') !== settings.origin.origin) {
    return problem(403, 'Origine de la demande refusée', options.path);
  }
  const correlation = randomUUID();
  const type = request.headers.get('content-type')?.split(';', 1)[0].trim();
  const multipart = type === 'multipart/form-data' && !!options.multipart;
  const form = type === 'application/x-www-form-urlencoded' || multipart;
  let actor: string | null = null;
  let input: Input | null = null;
  try {
    actor = await sessionAccount(settings, request.cookies.get(cookieName(settings, 'session'))?.value);
    ensure(actor, 401, 'Session institutionnelle requise');
    ensure(form || type === 'application/json', 415, 'Format de requête non pris en charge');
    if (multipart) {
      const body = await readBody(request, options.multipart!);
      const parsed = new Response(body, { headers: { 'content-type': request.headers.get('content-type') ?? '' } });
      const entries = await parsed.formData().catch(() => { throw new Problem(400, 'Formulaire invalide'); });
      input = Object.fromEntries(entries.entries());
    } else {
      input = await readInput(request, form, options.repeated);
    }
    const result = await handle({ settings, actor, operation, correlation, form, request }, input);
    if (!form) return privateJson(result);
    const url = back(settings, options, input, result as Record<string, unknown>, operation);
    url.searchParams.set('message', 'saved');
    return redirectTo(url);
  } catch (error) {
    const outcome = failure(error, options);
    if (actor && outcome.status === 403) {
      await auditDenial(settings, actor, options.denial, correlation).catch(() => console.error('unoa-denial-audit'));
    }
    if (!form || outcome.status === 401) return problem(outcome.status, outcome.message, options.path, correlation);
    const url = back(settings, options, input, null, operation);
    url.searchParams.set('error', String(outcome.status));
    return redirectTo(url);
  }
}
