import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { cookieName, iamSettings } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { privateJson, problem, redirectTo, unavailable } from '@/lib/iam/responses';
import { ConfigProblem, requireConfig, uuid } from '@/lib/config/validation';
import { readInput, storageError } from '@/lib/studio/requests';
import {
  attachTerritory, auditTerritoryDenial, closeAttachment, createScopeType, createTerritory,
  readableTerritories, scopeTypeCatalogue, setTerritoryLabel, territoryDetails, updateTerritory,
} from '@/lib/territory/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const path = '/api/v1/territories';
const studio = '/administration/territoires';

function territoryError(error: unknown) {
  return storageError(error, 'unoa-territory-storage', 'Registre territorial temporairement indisponible');
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const settings = iamSettings();
  if (!settings) return unavailable(path);
  const correlation = randomUUID();
  let actor: string | null = null;
  try {
    actor = await sessionAccount(settings, request.cookies.get(cookieName(settings, 'session'))?.value);
    requireConfig(actor, 401, 'Session institutionnelle requise');
    const { operation } = await params;
    const query = request.nextUrl.searchParams;
    const route = operation.join('/');
    if (route === 'types') return privateJson({ types: await scopeTypeCatalogue(settings) });
    if (route === 'scopes') {
      const scopeId = query.get('scopeId');
      if (scopeId) {
        const after = query.get('after');
        return privateJson(await territoryDetails(settings, actor, uuid(scopeId), after ? uuid(after) : undefined));
      }
      const cursor = query.get('after');
      const scopes = await readableTerritories(settings, actor, cursor ? uuid(cursor) : undefined);
      return privateJson({ scopes: scopes.slice(0, 50), next: scopes.length > 50 ? scopes[49].id : null });
    }
    return problem(404, 'Opération inconnue', path, correlation);
  } catch (error) {
    const outcome = territoryError(error);
    if (actor && outcome.status === 403) {
      await auditTerritoryDenial(settings, actor, correlation).catch(() => console.error('unoa-territory-denial-audit'));
    }
    return problem(outcome.status, outcome.message, path, correlation);
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const settings = iamSettings();
  if (!settings) return unavailable(path);
  if (request.headers.get('origin') !== settings.origin.origin) {
    return problem(403, 'Origine de la demande refusée', path);
  }

  const correlation = randomUUID();
  const type = request.headers.get('content-type')?.split(';', 1)[0].trim();
  const form = type === 'application/x-www-form-urlencoded';
  const url = new URL(studio, settings.origin);
  let actor: string | null = null;
  // Every browser form carries the studio scope so a refusal returns to the same view.
  let contextScope = '';
  try {
    actor = await sessionAccount(settings, request.cookies.get(cookieName(settings, 'session'))?.value);
    requireConfig(actor, 401, 'Session institutionnelle requise');
    requireConfig(form || type === 'application/json', 415, 'Format de requête non pris en charge');
    const input = await readInput(request, form, ['parentTypes']);
    if (typeof input.scopeId === 'string') contextScope = uuid(input.scopeId);
    const { operation } = await params;
    const [resource, id, action] = operation;
    let result: { scopeId: string; id?: string; code?: string };
    if (resource === 'types' && operation.length === 1) {
      result = await createScopeType(settings, actor, input, correlation);
    } else if (resource === 'scopes' && operation.length === 1) {
      result = await createTerritory(settings, actor, input, correlation);
    } else if (resource === 'scopes' && operation.length === 3 && action === 'update') {
      result = await updateTerritory(settings, actor, id, input, correlation);
    } else if (resource === 'scopes' && operation.length === 3 && action === 'labels') {
      result = await setTerritoryLabel(settings, actor, id, input, correlation);
    } else if (resource === 'scopes' && operation.length === 3 && action === 'attachments') {
      result = await attachTerritory(settings, actor, id, input, correlation);
    } else if (resource === 'attachments' && operation.length === 3 && action === 'close') {
      result = await closeAttachment(settings, actor, id, input, correlation);
    } else {
      throw new ConfigProblem(404, 'Opération inconnue');
    }
    if (!form) return privateJson(result);
    url.searchParams.set('scope', result.scopeId);
    url.searchParams.set('message', 'saved');
    return redirectTo(url);
  } catch (error) {
    const outcome = territoryError(error);
    if (actor && outcome.status === 403) {
      await auditTerritoryDenial(settings, actor, correlation).catch(() => console.error('unoa-territory-denial-audit'));
    }
    if (!form || outcome.status === 401) return problem(outcome.status, outcome.message, path, correlation);
    if (contextScope) url.searchParams.set('scope', contextScope);
    url.searchParams.set('error', String(outcome.status));
    return redirectTo(url);
  }
}
