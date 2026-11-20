import { iamSettings } from '@/lib/iam/settings';
import { problem } from '@/lib/server/responses';
import { publicOrganisation } from '@/lib/org/store';
import { publicJson } from '@/lib/catalog/public';

const path = '/api/v1/public/organisation';

export async function GET() {
  const settings = iamSettings();
  if (!settings) return problem(503, 'Organigramme indisponible', path);
  try {
    return publicJson(await publicOrganisation(settings));
  } catch {
    console.error('unoa-public-organisation');
    return problem(503, 'Organigramme indisponible', path);
  }
}
