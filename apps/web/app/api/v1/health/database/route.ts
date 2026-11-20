import { iamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';

export const dynamic = 'force-dynamic';

// Database probe: configured, reachable, and running with the restricted role.
// It reveals no address, user name or version.
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  const settings = iamSettings();
  if (!settings) return Response.json({ database: 'not_configured' }, { status: 503, headers });
  try {
    const { rows } = await database(settings).query<{ restricted: boolean; schema: boolean }>(`
      SELECT NOT (SELECT rolsuper OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname = current_user) AS restricted,
             has_schema_privilege('unoa', 'USAGE') AS schema
    `);
    return Response.json({ database: 'connected', restricted: rows[0].restricted, schema: rows[0].schema,
      signIn: settings.oidc ? 'configured' : 'not_configured' }, { headers });
  } catch {
    return Response.json({ database: 'unavailable' }, { status: 503, headers });
  }
}
