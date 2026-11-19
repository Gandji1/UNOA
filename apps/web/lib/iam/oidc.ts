import 'server-only';
import { EncryptJWT, jwtDecrypt } from 'jose';
import * as oidc from 'openid-client';
import { callbackPath, loginDurationSeconds, type IamSettings } from './settings';

let discovered: Promise<oidc.Configuration> | undefined;

function provider(settings: IamSettings) {
  if (!discovered) {
    const execute = [oidc.enableNonRepudiationChecks];
    if (settings.issuer.protocol === 'http:') execute.push(oidc.allowInsecureRequests);
    discovered = oidc.discovery(
      settings.issuer,
      settings.clientId,
      { id_token_signed_response_alg: 'RS256' },
      oidc.ClientSecretBasic(settings.clientSecret),
      { execute, timeout: 8 },
    ).catch(error => {
      discovered = undefined;
      throw error;
    });
  }
  return discovered;
}

export async function startLogin(settings: IamSettings) {
  const config = await provider(settings);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const verifier = oidc.randomPKCECodeVerifier();
  const target = oidc.buildAuthorizationUrl(config, {
    redirect_uri: new URL(callbackPath, settings.origin).href,
    scope: 'openid',
    state,
    nonce,
    acr_values: settings.assurance,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
  });
  const cookie = await new EncryptJWT({ state, nonce, verifier })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setAudience('unoa-oidc-transaction')
    .setExpirationTime(Math.floor(Date.now() / 1000) + loginDurationSeconds)
    .encrypt(settings.transactionKey);
  return { target, cookie };
}

export async function verifiedSubject(settings: IamSettings, search: string, loginCookie: string) {
  const { payload } = await jwtDecrypt(loginCookie, settings.transactionKey, {
    audience: 'unoa-oidc-transaction',
    keyManagementAlgorithms: ['dir'],
    contentEncryptionAlgorithms: ['A256GCM'],
    requiredClaims: ['exp'],
  });
  const { state, nonce, verifier } = payload;
  if (typeof state !== 'string' || typeof nonce !== 'string' || typeof verifier !== 'string') return null;

  const url = new URL(callbackPath, settings.origin);
  url.search = search;
  const tokens = await oidc.authorizationCodeGrant(await provider(settings), url, {
    pkceCodeVerifier: verifier,
    expectedState: state,
    expectedNonce: nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims || claims.acr !== settings.assurance) return null;
  return { issuer: claims.iss, subject: claims.sub };
}
