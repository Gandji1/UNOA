import 'server-only';

export interface OidcSettings {
  issuer: URL;
  clientId: string;
  clientSecret: string;
  assurance: string;
  transactionKey: Uint8Array;
}

export interface IamSettings {
  origin: URL;
  databaseUrl: string;
  // Set when the connection string belongs to the schema owner (Neon ↔ Vercel
  // integration): every connection switches to this restricted role first.
  databaseRole: string | null;
  // Institutional sign-in; null until a provider is configured (public pages still work).
  oidc: OidcSettings | null;
}

function allowedWebUrl(value: string) {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      !(url.protocol === 'https:' ||
        (process.env.NODE_ENV !== 'production' && loopback && url.protocol === 'http:'))) {
    throw new Error('Invalid IAM URL');
  }
  return url;
}

function oidcSettings(): OidcSettings | null {
  const {
    UNOA_OIDC_ISSUER: issuerUrl, UNOA_OIDC_CLIENT_ID: clientId, UNOA_OIDC_CLIENT_SECRET: clientSecret,
    UNOA_OIDC_MFA_ACR: assurance, UNOA_OIDC_TRANSACTION_KEY: transactionSecret,
  } = process.env;
  if (!issuerUrl || !clientId || !clientSecret || !assurance || !transactionSecret) return null;
  try {
    const issuer = allowedWebUrl(issuerUrl);
    const transactionKey = Buffer.from(transactionSecret, 'base64url');
    if (issuer.pathname.includes('/.well-known/') || transactionKey.length !== 32 || transactionKey.toString('base64url') !== transactionSecret) return null;
    return { issuer, clientId, clientSecret, assurance, transactionKey };
  } catch {
    return null;
  }
}

// Connection: the dedicated restricted login (UNOA_IAM_DATABASE_URL), or the
// direct (unpooled) URL injected by the Neon ↔ Vercel integration, used with
// SET ROLE unoa_web. Production always verifies the server certificate.
function databaseSettings() {
  const dedicated = process.env.UNOA_IAM_DATABASE_URL;
  const integrated = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
  const value = dedicated || integrated;
  if (!value) return null;
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) return null;
  if (dedicated) {
    if (process.env.NODE_ENV === 'production' && url.searchParams.get('sslmode') !== 'verify-full') return null;
    return { databaseUrl: value, databaseRole: null };
  }
  url.searchParams.delete('channel_binding');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) url.searchParams.set('sslmode', 'verify-full');
  return { databaseUrl: url.href, databaseRole: process.env.UNOA_DATABASE_ROLE || 'unoa_web' };
}

export function iamSettings(): IamSettings | null {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const webOrigin = process.env.UNOA_WEB_ORIGIN || (vercel ? 'https://' + vercel : undefined);
  if (!webOrigin) return null;
  try {
    const origin = allowedWebUrl(webOrigin);
    const database = databaseSettings();
    if (origin.pathname !== '/' || !database) return null;
    return { origin, ...database, oidc: oidcSettings() };
  } catch {
    return null;
  }
}

export const callbackPath = '/api/v1/auth/callback';
export const sessionDurationSeconds = 8 * 60 * 60;
export const loginDurationSeconds = 5 * 60;
export const scopeIdFormat = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const permissionFormat = /^[a-z][a-z0-9_.]{0,95}$/;

export function cookieName(settings: IamSettings, kind: 'login' | 'session' | 'invitation') {
  return (settings.origin.protocol === 'https:' ? '__Host-' : '') + 'unoa_' + kind;
}

export function cookieOptions(settings: IamSettings, maxAge: number) {
  return {
    secure: settings.origin.protocol === 'https:',
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}
