import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { cookieName, iamSettings } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { privateJson, problem, redirectTo, unavailable } from '@/lib/iam/responses';
import { auditConfigDenial, catalogue, createDefinition, createValue, resolveConfiguration, transitionValue } from '@/lib/config/store';
import { ConfigProblem, keyName, requireConfig, utcTime, uuid } from '@/lib/config/validation';
import { readInput, storageError } from '@/lib/studio/requests';

type RouteContext = { params: Promise<{ operation: string[] }> };

function configError(error: unknown) {
  return storageError(error, 'unoa-config-storage', 'Configuration temporairement indisponible');
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const path = '/api/v1/config';
  const settings = iamSettings();
  if (!settings) return unavailable(path);
  const correlation = randomUUID();
  let actor: string | null = null;
  try {
    actor = await sessionAccount(settings, request.cookies.get(cookieName(settings, 'session'))?.value);
    requireConfig(actor, 401, 'Session institutionnelle requise');
    const { operation } = await params;
    const query = request.nextUrl.searchParams;
    const scopeId = uuid(query.get('scopeId'));
    if (operation.join('/') === 'definitions') {
      const cursor = query.get('after');
      const { definitions } = await catalogue(settings, actor, scopeId, cursor ? keyName(cursor) : undefined);
      return privateJson({
        definitions: definitions.slice(0, 24),
        next: definitions.length > 24 ? definitions[23].key : null,
      });
    }
    if (operation.join('/') === 'resolve') {
      const key = keyName(query.get('key'));
      const at = utcTime(query.get('at') || new Date().toISOString());
      return privateJson(await resolveConfiguration(settings, actor, scopeId, key, at));
    }
    return problem(404, 'Opération inconnue', path, correlation);
  } catch (error) {
    const outcome = configError(error);
    if (actor && outcome.status === 403) {
      await auditConfigDenial(settings, actor, correlation).catch(() => console.error('unoa-config-denial-audit'));
    }
    return problem(outcome.status, outcome.message, path, correlation);
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const path = '/api/v1/config';
  const settings = iamSettings();
  if (!settings) return unavailable(path);
  if (request.headers.get('origin') !== settings.origin.origin) {
    return problem(403, 'Origine de la demande refusée', path);
  }

  const correlation = randomUUID();
  const type = request.headers.get('content-type')?.split(';', 1)[0].trim();
  const form = type === 'application/x-www-form-urlencoded';
  const url = new URL('/administration/parametres', settings.origin);
  let actor: string | null = null;
  try {
    actor = await sessionAccount(settings, request.cookies.get(cookieName(settings, 'session'))?.value);
    requireConfig(actor, 401, 'Session institutionnelle requise');
    requireConfig(form || type === 'application/json', 415, 'Format de requête non pris en charge');
    const input = await readInput(request, form, ['allowedTypes']);
    url.searchParams.set('scope', uuid(input.scopeId));
    if (typeof input.key === 'string' && input.key.length <= 96) url.searchParams.set('key', input.key);
    const { operation } = await params;
    const [resource, id, action] = operation;
    let result: { key: string; scopeId: string; id?: string };
    if (resource === 'definitions' && operation.length === 1) {
      result = await createDefinition(settings, actor, input, form, correlation);
    } else if (resource === 'values' && operation.length === 1) {
      if (!form) input.requestId = request.headers.get('idempotency-key');
      result = await createValue(settings, actor, input, form, correlation);
    } else if (resource === 'versions' && operation.length === 3) {
      result = await transitionValue(settings, actor, id, action, input, correlation);
    } else {
      throw new ConfigProblem(404, 'Opération inconnue');
    }
    if (!form) return privateJson(result);
    url.searchParams.set('key', result.key);
    url.searchParams.set('message', 'saved');
    if (result.id && action !== 'publish') url.searchParams.set('preview', result.id);
    return redirectTo(url);
  } catch (error) {
    const outcome = configError(error);
    if (actor && outcome.status === 403) {
      await auditConfigDenial(settings, actor, correlation).catch(() => console.error('unoa-config-denial-audit'));
    }
    if (!form || outcome.status === 401) return problem(outcome.status, outcome.message, path, correlation);
    url.searchParams.set('error', String(outcome.status));
    return redirectTo(url);
  }
}
