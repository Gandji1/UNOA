import type { NextRequest } from 'next/server';
import { simulatePlan } from '@unoa/domain/curriculum';
import { iamSettings, scopeIdFormat } from '@/lib/iam/settings';
import { problem } from '@/lib/server/responses';
import { publicJson, publicPrograms, publicSheet, sheetModel } from '@/lib/catalog/public';
import { siteForRequest } from '@/lib/site/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const path = '/api/v1/public/programs';

// Public directory: published versions only, read through SECURITY DEFINER functions.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const settings = iamSettings();
  if (!settings) return problem(503, 'Catalogue indisponible', path);
  const { operation } = await params;
  try {
    const site = await siteForRequest(request);
    if (!site) return problem(404, 'Aucun site public pour cette adresse', path);
    if (operation.length === 1 && operation[0] === 'all') return publicJson({ programs: await publicPrograms(settings, site.site_id) });
    const [id, action] = operation;
    if (!scopeIdFormat.test(id ?? '')) return problem(404, 'Programme introuvable', path);
    const sheet = await publicSheet(settings, site.site_id, id);
    if (!sheet) return problem(404, 'Programme introuvable', path);
    if (operation.length === 1) return publicJson(sheet);
    if (action === 'simulate') {
      const choices = request.nextUrl.searchParams.getAll('choice').filter(value => scopeIdFormat.test(value)).slice(0, 200);
      return publicJson(simulatePlan(sheetModel(sheet), choices));
    }
    return problem(404, 'Opération inconnue', path);
  } catch {
    console.error('unoa-public-catalogue');
    return problem(503, 'Catalogue indisponible', path);
  }
}
