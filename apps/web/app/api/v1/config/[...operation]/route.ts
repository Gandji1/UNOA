import type { NextRequest } from 'next/server';
import { catalogue, createDefinition, createValue, resolveConfiguration, transitionValue } from '@/lib/config/store';
import { keyName } from '@/lib/config/validation';
import { Problem, utcTime, uuid, type Input } from '@/lib/shared/validation';
import { studioGet, studioPost, type StudioOptions } from '@/lib/server/route';
import { scopeIdFormat } from '@/lib/iam/settings';

type RouteContext = { params: Promise<{ operation: string[] }> };

// The studio view keeps the scope, the key and the version being previewed.
function view(input: Input, result: Record<string, unknown> | null, operation: string[]) {
  const fields: Record<string, string> = {};
  if (typeof input.scopeId === 'string' && scopeIdFormat.test(input.scopeId)) fields.scope = input.scopeId;
  const key = result?.key ?? input.key;
  if (typeof key === 'string' && key.length <= 96) fields.key = key;
  if (typeof result?.id === 'string' && operation[2] !== 'publish') fields.preview = result.id;
  return fields;
}

const options: StudioOptions = {
  path: '/api/v1/config', studio: '/administration/parametres', denial: 'config.access', label: 'config',
  repeated: ['allowedTypes'], view,
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const scopeId = uuid(query.get('scopeId'));
    if (operation.join('/') === 'definitions') {
      const cursor = query.get('after');
      const { definitions } = await catalogue(settings, actor, scopeId, cursor ? keyName(cursor) : undefined);
      return { definitions: definitions.slice(0, 24), next: definitions.length > 24 ? definitions[23].key : null };
    }
    if (operation.join('/') === 'resolve') {
      const key = keyName(query.get('key'));
      const at = utcTime(query.get('at') || new Date().toISOString());
      return resolveConfiguration(settings, actor, scopeId, key, at);
    }
    return null;
  });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation, form, request: call }, input) => {
    uuid(input.scopeId);
    const [resource, id, action] = operation;
    if (resource === 'definitions' && operation.length === 1) return createDefinition(settings, actor, input, form, correlation);
    if (resource === 'values' && operation.length === 1) {
      if (!form) input.requestId = call.headers.get('idempotency-key');
      return createValue(settings, actor, input, form, correlation);
    }
    if (resource === 'versions' && operation.length === 3) return transitionValue(settings, actor, id, action, input, correlation);
    throw new Problem(404, 'Opération inconnue');
  });
}
