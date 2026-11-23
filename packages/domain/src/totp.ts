import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Time-based one-time passwords (RFC 6238 / RFC 4226): HMAC-SHA1, 30 s, 6 digits,
// compatible with common authenticator apps. Secrets are base32 (RFC 4648).

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newSecret(bytes = 20) {
  return base32(randomBytes(bytes));
}

export function base32(data: Uint8Array) {
  let bits = 0; let value = 0; let output = '';
  for (const byte of data) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

export function fromBase32(text: string) {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  if (!/^[A-Z2-7]+$/.test(clean)) throw new Error('Invalid base32');
  let bits = 0; let value = 0; const bytes: number[] = [];
  for (const char of clean) {
    value = (value << 5) | alphabet.indexOf(char); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

export function code(secret: string, time = Date.now(), step = 30) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / step)));
  const digest = createHmac('sha1', fromBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, '0');
}

// Accepts the current step and one step before or after (clock drift).
export function verify(secret: string, candidate: string, time = Date.now()) {
  if (!/^\d{6}$/.test(candidate)) return false;
  return [-1, 0, 1].some(drift => timingSafeEqual(Buffer.from(code(secret, time + drift * 30_000)), Buffer.from(candidate)));
}

export function otpauthUri(secret: string, issuer: string, account: string) {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
