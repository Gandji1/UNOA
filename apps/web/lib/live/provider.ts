import 'server-only';
import { SignJWT } from 'jose';

// Jitsi-compatible videoconference provider authenticated by short-lived JWT.
// Without its three settings the provider is reported as not configured:
// sessions are still planned, but no link is produced.
export interface LiveProvider { domain: string; appId: string; secret: Uint8Array }

export function liveProvider(): LiveProvider | null {
  const { UNOA_LIVE_JITSI_DOMAIN: domain, UNOA_LIVE_JITSI_APP_ID: appId, UNOA_LIVE_JITSI_SECRET: secret } = process.env;
  if (!domain || !appId || !secret || secret.length < 32 || !/^[a-z0-9.-]+$/.test(domain) || !/^[\w.-]{1,64}$/.test(appId)) return null;
  return { domain, appId, secret: new TextEncoder().encode(secret) };
}

export async function joinUrl(provider: LiveProvider, room: string, user: { id: string; name: string; moderator: boolean },
  validUntil: Date) {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    room,
    context: { user: { id: user.id, name: user.name, moderator: user.moderator } },
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(provider.appId)
    .setAudience('jitsi')
    .setSubject(provider.domain)
    .setNotBefore(now - 30)
    .setIssuedAt(now)
    .setExpirationTime(Math.min(Math.floor(validUntil.getTime() / 1000), now + 12 * 3600))
    .sign(provider.secret);
  return `https://${provider.domain}/${room}?jwt=${token}`;
}
