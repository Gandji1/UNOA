import test from 'node:test';
import assert from 'node:assert/strict';
import { base32, code, fromBase32, newSecret, otpauthUri, verify } from '../src/totp.ts';

test('TOTP conforme aux vecteurs RFC 6238 (SHA-1)', () => {
  const secret = base32(Buffer.from('12345678901234567890'));
  // RFC 6238 annexe B, 8 chiffres 94287082 → 6 derniers chiffres 287082 à t = 59 s
  assert.equal(code(secret, 59_000), '287082');
  assert.equal(code(secret, 1111111109_000), '081804');
  assert.equal(code(secret, 2000000000_000), '279037');
});

test('Vérification avec dérive d’une période, refus sinon', () => {
  const secret = newSecret();
  assert.equal(fromBase32(secret).length, 20);
  const now = 1_800_000_000_000;
  assert.ok(verify(secret, code(secret, now), now));
  assert.ok(verify(secret, code(secret, now - 30_000), now));
  assert.ok(!verify(secret, code(secret, now - 90_000), now));
  assert.ok(!verify(secret, 'abcdef', now));
  assert.match(otpauthUri(secret, 'UNOA', 'admin'), /^otpauth:\/\/totp\/UNOA:admin\?secret=[A-Z2-7]+&issuer=UNOA/);
});
