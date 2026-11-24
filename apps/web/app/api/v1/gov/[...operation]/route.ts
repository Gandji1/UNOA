import type { NextRequest } from 'next/server';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import { councilDetails, govAction, govContexts, govOverview, meetingDetails, myCouncils } from '@/lib/governance/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const actions = ['councils', 'members', 'end-member', 'delegations', 'meetings', 'items', 'withdraw-item', 'convene', 'attendance', 'open', 'open-vote',
  'close-item', 'close-meeting', 'minutes', 'sign', 'publish', 'documents', 'archive', 'vote', 'conflict', 'appeal', 'rule-appeal'];
const options = {
  path: '/api/v1/gov', studio: '/administration/gouvernance', denial: 'gov.access', label: 'gov', returns: ['/conseils'],
  view: (input: Record<string, unknown>, result: Record<string, unknown> | null) => {
    const view: Record<string, string> = {};
    for (const [key, name] of [['meetingId', 'seance'], ['councilId', 'conseil'], ['scopeId', 'scope']] as const) {
      const value = String(result?.[key] ?? input[key] ?? '');
      if (/^[0-9a-f-]{36}$/.test(value)) { view[name] = value; break; }
    }
    return view;
  },
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource, id] = operation;
    if (resource === 'scopes' && operation.length === 1) {
      const scopeId = query.get('scopeId');
      return scopeId ? govOverview(settings, actor, scopeId) : { scopes: await govContexts(settings, actor) };
    }
    if (resource === 'councils' && operation.length === 2) return councilDetails(settings, actor, id);
    if (resource === 'meetings' && operation.length === 2) return meetingDetails(settings, actor, id);
    if (resource === 'me') return { councils: await myCouncils(settings, actor) };
    return null;
  });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    if (operation.length !== 1 || !actions.includes(operation[0])) throw new Problem(404, 'Opération inconnue');
    return govAction(settings, actor, operation[0], input, correlation);
  });
}
