import { problem } from '@/lib/server/responses';
import { publicOrganisation } from '@/lib/org/store';
import { publicJson } from '@/lib/catalog/public';
import { iamSettings } from '@/lib/iam/settings';
import { siteForRequest } from '@/lib/site/store';

const path = '/api/v1/public/organisation';

export async function GET(request: Request) {
  const settings = iamSettings();
  if (!settings) return problem(503, 'Organigramme indisponible', path);
  try {
    const site = await siteForRequest(request);
    if (!site) return problem(404, 'Aucun site public pour cette adresse', path);
    return publicJson(await publicOrganisation(settings, site.site_id));
  } catch {
    console.error('unoa-public-organisation');
    return problem(503, 'Organigramme indisponible', path);
  }
}
