import 'server-only';

export interface IamSettings {
  origin: URL;
  issuer: URL;
  clientId: string;
  clientSecret: string;
  assurance: string;
  databaseUrl: string;
  transactionKey: Uint8Array;
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

export function iamSettings(): IamSettings | null {
  const {
    UNOA_WEB_ORIGIN: webOrigin,
    UNOA_OIDC_ISSUER: issuerUrl,
    UNOA_OIDC_CLIENT_ID: clientId,
    UNOA_OIDC_CLIENT_SECRET: clientSecret,
    UNOA_OIDC_MFA_ACR: assurance,
    UNOA_IAM_DATABASE_URL: databaseUrl,
    UNOA_OIDC_TRANSACTION_KEY: transactionSecret,
  } = process.env;

  if (!webOrigin || !issuerUrl || !clientId || !clientSecret ||
      !assurance || !databaseUrl || !transactionSecret) return null;

  try {
    const origin = allowedWebUrl(webOrigin);
    const issuer = allowedWebUrl(issuerUrl);
    const database = new URL(databaseUrl);
    const transactionKey = Buffer.from(transactionSecret, 'base64url');
    if (origin.pathname !== '/' || issuer.pathname.includes('/.well-known/') ||
        !['postgres:', 'postgresql:'].includes(database.protocol) ||
        (process.env.NODE_ENV === 'production' && database.searchParams.get('sslmode') !== 'verify-full') ||
        transactionKey.length !== 32 || transactionKey.toString('base64url') !== transactionSecret) {
      return null;
    }
    return { origin, issuer, clientId, clientSecret, assurance, databaseUrl, transactionKey };
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
