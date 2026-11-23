import { iamSettings } from '@/lib/iam/settings';
import { Client } from 'pg';
import { database } from '@/lib/iam/sessions';
import deployReport from '@/lib/server/deploy-report.json';

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
    // Integrated owner URL: say which database it reaches and whether it is migrated.
    let target: Record<string, unknown> | undefined;
    if (settings.databaseRole) {
      const owner = new Client({ connectionString: settings.databaseUrl, connectionTimeoutMillis: 5000 });
      try {
        await owner.connect();
        const { rows } = await owner.query(`SELECT current_database() AS name,
          EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS role_exists,
          to_regnamespace('unoa') IS NOT NULL AS schema_exists`, [settings.databaseRole]);
        target = rows[0];
      } catch { target = { reachable: false }; } finally { await owner.end().catch(() => undefined); }
    }
    return Response.json({ database: 'unavailable', code, tls, mode: settings.databaseRole ? 'integration' : 'dedicated', target, deploy: deployReport }, { status: 503, headers });
  }
}
