import { iamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';

export const dynamic = 'force-dynamic';

// Database probe: configured, reachable, and running with the restricted role.
// It reveals no address, user name or version.
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  const settings = iamSettings();
  if (!settings) {
    // Names only, never values: which configuration inputs the deployment received.
    const present = (name: string) => !!process.env[name];
    return Response.json({ database: 'not_configured', inputs: Object.fromEntries(
      ['UNOA_WEB_ORIGIN', 'VERCEL_PROJECT_PRODUCTION_URL', 'UNOA_IAM_DATABASE_URL', 'DATABASE_URL', 'DATABASE_URL_UNPOOLED',
        'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'PGHOST'].map(name => [name, present(name)])) }, { status: 503, headers });
  }
  try {
    const { rows } = await database(settings).query<{ restricted: boolean; schema: boolean }>(`
      SELECT NOT (SELECT rolsuper OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname = current_user) AS restricted,
             has_schema_privilege('unoa', 'USAGE') AS schema
    `);
    return Response.json({ database: 'connected', restricted: rows[0].restricted, schema: rows[0].schema,
      signIn: settings.oidc ? 'configured' : 'not_configured' }, { headers });
  } catch (error) {
    // SQLSTATE or network error class only (e.g. 28P01, 42704, ECONNREFUSED): no address or credential.
    const code = typeof error === 'object' && error && 'code' in error && /^[A-Z0-9_]{3,20}$/.test(String(error.code)) ? String(error.code) : 'unknown';
    const tls = error instanceof Error && /certificate|self.signed|SSL|TLS/i.test(error.message) ? 'tls' : undefined;
    return Response.json({ database: 'unavailable', code, tls, role: settings.databaseRole ? 'startup' : 'dedicated' }, { status: 503, headers });
  }
}
