import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessToken } from '../src/accounts/access-token.ts';
import { hasValidWebSocketOrigin } from '../src/http-security.ts';
import { isProductionHttp } from '../src/http-security.ts';
import { authProvider } from '../src/accounts/auth-provider.ts';
import { currentAccount } from '../src/accounts/auth.ts';

test('Access JWT can fall back to the browser authorization cookie', async () => {
  const request = new Request('https://edgessh.example.workers.dev/api/auth/me', {
    headers: { Cookie: 'unrelated=value; CF_Authorization=not-a-jwt; another=value' },
  });
  assert.equal(accessToken(request), 'not-a-jwt');
});

test('missing Access header and cookie is reported as unauthenticated', async () => {
  const request = new Request('https://edgessh.example.workers.dev/api/auth/me');
  assert.equal(accessToken(request), null);
});

test('Access assertion header takes precedence over the browser cookie', async () => {
  const request = new Request('https://edgessh.example.workers.dev/api/auth/me', {
    headers: {
      'Cf-Access-Jwt-Assertion': 'header-token',
      Cookie: 'CF_Authorization=cookie-token',
    },
  });
  assert.equal(accessToken(request), 'header-token');
});

test('WebSocket upgrades require an explicit same-origin browser header', () => {
  const url = 'https://ssh.example.com/api/ssh';
  assert.equal(hasValidWebSocketOrigin(new Request(url)), false);
  assert.equal(hasValidWebSocketOrigin(new Request(url, { headers: { Origin: 'https://other.example.com' } })), false);
  assert.equal(hasValidWebSocketOrigin(new Request(url, { headers: { Origin: 'https://ssh.example.com' } })), true);
});

test('strict local development authentication bypasses remote providers', async () => {
  assert.equal(authProvider({ AUTH_PROVIDER: 'cloudflare', DEV_AUTH: 'true' }), 'local-dev');
  assert.deepEqual(await currentAccount(new Request('http://localhost/api/auth/me'), {
    DEV_AUTH: 'true', AUTH_PROVIDER: 'cloudflare', DB: {} as D1Database,
  } as never), { id: 'local-development', username: 'local-development' });
});

test('local development authentication requires the exact true value', () => {
  for (const value of [undefined, 'false', 'TRUE', '1']) {
    assert.equal(authProvider({ AUTH_PROVIDER: 'cloudflare', DEV_AUTH: value }), 'cloudflare');
  }
});

test('local development requests are not redirected from HTTP to HTTPS', () => {
  const request = new Request('http://127.0.0.1:8787/', { headers: { 'CF-Connecting-IP': '127.0.0.1' } });
  assert.equal(isProductionHttp(request, true), false);
  assert.equal(isProductionHttp(request, false), true);
});
