import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/preview-worker.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral',
});
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const session = 'a'.repeat(64);
const token = '00000000-0000-0000-0000-000000000000';

function makeEnv(origin: string, devAuth?: string) {
  const calls: Request[] = [];
  const env = {
    PREVIEW_ORIGIN: origin,
    DEV_AUTH: devAuth,
    SSH_SESSIONS: {
      idFromString(id: string) { assert.equal(id, session); return id; },
      get() {
        return { async fetch(request: Request) {
          calls.push(request);
          return new URL(request.url).pathname === '/preview-launch'
            ? Response.json({ token, maxAge: 60 }) : new Response('upstream');
        } };
      },
    },
  };
  return { env, calls };
}

test('preview HTTP requires explicit development mode and a loopback origin', async () => {
  for (const devAuth of [undefined, 'false', 'TRUE']) {
    const { env } = makeEnv('http://127.0.0.1:8318', devAuth);
    assert.equal((await worker.fetch(new Request(`${env.PREVIEW_ORIGIN}/__edgessh/start`), env)).status, 403);
  }
  for (const origin of ['http://127.0.0.1:8318', 'http://preview.localhost:8318', 'http://[::1]:8318']) {
    const { env } = makeEnv(origin, 'true');
    assert.equal((await worker.fetch(new Request(`${origin}/__edgessh/start`), env)).status, 200);
    assert.equal((await worker.fetch(new Request('http://other.localhost:8318/__edgessh/start'), env)).status, 403);
  }
  const { env } = makeEnv('http://preview.example.com:8318', 'true');
  assert.equal((await worker.fetch(new Request(`${env.PREVIEW_ORIGIN}/__edgessh/start`), env)).status, 403);
});

test('development launch and requests use only the HTTP development cookie', async () => {
  const origin = 'http://127.0.0.1:8318';
  const { env, calls } = makeEnv(origin, 'true');
  const response = await worker.fetch(new Request(`${origin}/__edgessh/launch`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: `${session}.${token}` }),
  }), env);
  assert.equal(response.status, 200);
  const cookie = response.headers.get('Set-Cookie');
  assert.equal(cookie, `edgessh-preview-dev=${session}.${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=60`);
  assert.equal(calls[0].headers.get('x-preview-origin'), origin);
  assert.equal((await worker.fetch(new Request(`${origin}/app`, {
    headers: { Cookie: cookie!.split(';')[0], 'x-preview-token': 'forged', 'x-account-id': 'forged' },
  }), env)).status, 200);
  assert.equal(calls[1].headers.get('x-preview-token'), token);
  assert.equal(calls[1].headers.has('x-account-id'), false);
  assert.equal((await worker.fetch(new Request(`${origin}/app`, {
    headers: { Cookie: `__Host-edgessh-preview=${session}.${token}` },
  }), env)).status, 401);
  assert.equal((await worker.fetch(new Request(`${origin}/app`, {
    headers: { Cookie: `${cookie!.split(';')[0]}; ${cookie!.split(';')[0]}` },
  }), env)).status, 401);
  assert.equal(calls.length, 2);
});

test('HTTPS retains the production Secure cookie and ignores development cookies', async () => {
  const origin = 'https://preview.other.test';
  const { env, calls } = makeEnv(origin);
  const response = await worker.fetch(new Request(`${origin}/__edgessh/launch`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: `${session}.${token}` }),
  }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Set-Cookie'), `__Host-edgessh-preview=${session}.${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=60`);
  assert.equal((await worker.fetch(new Request(`${origin}/app`, {
    headers: { Cookie: `edgessh-preview-dev=${session}.${token}` },
  }), env)).status, 401);
  assert.equal(calls.length, 1);
});

test('development preview still rejects cross-origin launch and service workers', async () => {
  const origin = 'http://127.0.0.1:8318';
  const { env, calls } = makeEnv(origin, 'true');
  assert.equal((await worker.fetch(new Request(`${origin}/__edgessh/launch`, {
    method: 'POST', headers: { Origin: 'http://localhost:8787', 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: `${session}.${token}` }),
  }), env)).status, 403);
  assert.equal((await worker.fetch(new Request(`${origin}/service-worker.js`, {
    headers: { 'Service-Worker': 'script' },
  }), env)).status, 403);
  assert.equal(calls.length, 0);
});
