import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

export async function startIssuer() {
  const keyId = 'unoa-test';
  const clientId = 'unoa-integration';
  const clientSecret = randomUUID();
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: keyId, alg: 'RS256', use: 'sig' };
  const codes = new Map();
  let user = { subject: 'staff-fixture', assurance: 'test-mfa' };
  let origin;

  const server = createServer(async (request, response) => {
    const json = (status, body) => response.writeHead(status, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(body));
    let step = 'request';
    try {
      const url = new URL(request.url, origin);
      if (url.pathname === '/.well-known/openid-configuration') {
        return json(200, {
          issuer: origin,
          authorization_endpoint: origin + '/authorize',
          token_endpoint: origin + '/token',
          jwks_uri: origin + '/jwks',
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
          code_challenge_methods_supported: ['S256'],
        });
      }
      if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
      if (url.pathname === '/authorize') {
        const input = url.searchParams;
        assert.equal(input.get('client_id'), clientId);
        assert.equal(input.get('scope'), 'openid');
        assert.equal(input.get('acr_values'), 'test-mfa');
        assert.equal(input.get('code_challenge_method'), 'S256');
        const code = randomUUID();
        const redirectUri = input.get('redirect_uri');
        codes.set(code, {
          user, redirectUri, nonce: input.get('nonce'), challenge: input.get('code_challenge'),
        });
        const redirect = new URL(redirectUri);
        redirect.searchParams.set('code', code);
        redirect.searchParams.set('state', input.get('state'));
        return response.writeHead(302, { Location: redirect.href }).end();
      }
      if (url.pathname === '/token') {
        step = 'client';
        assert.ok(request.headers.authorization?.startsWith('Basic '));
        const credentials = Buffer.from(request.headers.authorization.slice(6), 'base64').toString();
        const [username, password] = credentials.split(':').map(decodeURIComponent);
        assert.ok(username === clientId && password === clientSecret);
        step = 'body';
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const input = new URLSearchParams(Buffer.concat(chunks).toString());
        const code = input.get('code');
        const entry = codes.get(code);
        if (!entry) return json(400, { error: 'invalid_grant' });
        codes.delete(code);
        step = 'redirect_uri';
        assert.equal(input.get('redirect_uri'), entry.redirectUri);
        step = 'pkce';
        assert.equal(createHash('sha256').update(input.get('code_verifier')).digest('base64url'), entry.challenge);
        step = 'jwt';
        const idToken = await new SignJWT({ acr: entry.user.assurance, nonce: entry.nonce })
          .setProtectedHeader({ alg: 'RS256', kid: keyId })
          .setIssuer(origin)
          .setAudience(clientId)
          .setSubject(entry.user.subject)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey);
        return json(200, { token_type: 'Bearer', access_token: randomUUID(), id_token: idToken });
      }
      return json(404, {});
    } catch (error) {
      console.error('OIDC test fixture:', step, error.name);
      return json(400, { error: 'invalid_request' });
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  return {
    origin, clientId, clientSecret,
    useIdentity(subject, assurance) { user = { subject, assurance }; },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}
