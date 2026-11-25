import { NextResponse, type NextRequest } from 'next/server';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import { finAction, finContexts, financeExport, finOverview, myFinances, receiptDocument, sandboxOutcome } from '@/lib/finance/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const options = { path: '/api/v1/fin', studio: '/administration/finances', denial: 'fin.access', label: 'fin', returns: ['/finances', '/paiement'] };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  let file: { body: string; type: string; name: string } | null = null;
  const response = await studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource, id] = operation;
    if (resource === 'me' && operation.length === 1) return myFinances(settings, actor);
    if (resource === 'scopes' && operation.length === 1) {
      const scopeId = query.get('scopeId');
      return scopeId ? finOverview(settings, actor, scopeId) : { scopes: await finContexts(settings, actor) };
    }
    if (resource === 'export' && operation.length === 1) {
      const kind = query.get('kind') === 'balances' ? 'balances' : 'journal';
      file = { body: await financeExport(settings, actor, query.get('scopeId') ?? '', kind, query.get('from'), query.get('to')), type: 'text/csv; charset=utf-8', name: kind === 'balances' ? 'soldes.csv' : 'journal.csv' };
      return {};
    }
    if (resource === 'receipts' && operation.length === 2) {
      file = { body: await receiptDocument(settings, actor, id), type: 'text/plain; charset=utf-8', name: 'recu.txt' };
      return {};
    }
    return null;
  });
  if (!file) return response;
  const found = file as { body: string; type: string; name: string };
  return new NextResponse(found.body, { headers: { 'Content-Type': found.type, 'Content-Disposition': `attachment; filename="${found.name}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }, input) => {
    const [action] = operation;
    if (operation.length !== 1) throw new Problem(404, 'Opération inconnue');
    if (action === 'sandbox') return sandboxOutcome(settings, actor, input);
    return finAction(settings, actor, action, input, correlation);
  });
}
