import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
  stdin: {
    contents: `export { SSHSessionDO } from './src/backend/durable-object.ts';
      export { revokeWorkspaceSessions } from './src/accounts/workspace.ts';
      export { githubLogin, githubCallback } from './src/accounts/github-auth.ts';
      export { default as worker } from './src/worker.ts';`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'neutral', write: false,
  plugins: [{ name: 'no-network', setup(build) {
    build.onResolve({ filter: /^cloudflare:sockets$/ }, () => ({ path: 'sockets', namespace: 'test' }));
    build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: "export function connect() { throw new Error('Unexpected TCP connection'); }" }));
  } }],
});
const { SSHSessionDO, revokeWorkspaceSessions, githubLogin, githubCallback, worker } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=session-revocation-bundle.mjs').toString('base64')}`
);
const origin = 'https://preview.other.test';
const sessionId = 'a'.repeat(64);

async function fixture(provider = 'github') {
  const row = { account_id: 'owner', auth_provider: provider, auth_revision: 1, access_not_before: 0 };
  let databaseFailure = false;
  let databaseStalled = false;
  const DB = { prepare() {
    return { async first() {
      if (databaseFailure) throw new Error('Database unavailable');
      if (databaseStalled) return new Promise(() => {});
      return { ...row };
    }, bind() { return { async run() { row.auth_revision++; return { meta: { changes: 1 } }; } }; } };
  } };
  const storage = new Map<string, unknown>();
  const sockets: any[] = [];
  const tx = {
    get: async (key: string) => storage.get(key),
    put: async (key: string, value: unknown) => { storage.set(key, value); },
    delete: async (key: string) => storage.delete(key), setAlarm: async () => {}, deleteAlarm: async () => {},
  };
  const state = { getWebSockets: () => sockets, id: { toString: () => sessionId }, storage: { ...tx, transaction: (fn: any) => fn(tx) } };
  const object = new SSHSessionDO(state, { DB });
  const ticketRequest = (revision = '1') => new Request('https://internal/ticket', {
    method: 'POST', headers: { 'x-account-id': 'owner', 'x-auth-revision': revision },
  });
  assert.equal((await object.fetch(ticketRequest())).status, 200);
  const delivered: string[] = [];
  let closed = false;
  const ws = (role: string) => {
    const socket = { readyState: WebSocket.OPEN, codes: [] as number[], send() {},
      deserializeAttachment: () => ({ role, phase: 'connected' }),
      close(code: number) { if (this.readyState === WebSocket.OPEN) this.codes.push(code); this.readyState = WebSocket.CLOSED; } };
    sockets.push(socket);
    return socket;
  };
  const main = ws('main'), sftp = ws('sftp'), process = ws('process');
  const ssh = {
    isForwardReady: () => !closed,
    handleClientMessage: async () => { delivered.push('main'); },
    handleSFTPClientMessage: async () => { delivered.push('sftp'); },
    handleProcessClientMessage: async () => { delivered.push('process'); },
    detachSFTPWebSocket() {}, detachProcessWebSocket() {},
    close() { closed = true; },
    openForward: async () => ({ close: async () => {}, write: async () => {}, abort() {},
      readable: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok')); c.close(); } }),
    }),
  };
  object.sessions.set(main, ssh);
  for (const [kind, socket] of [['sftp', sftp], ['process', process]] as const) {
    object[`${kind}Sessions`].set(socket, ssh);
    object[`${kind}Owners`].set(socket, main);
    object[`${kind}WebSocketsByMain`].set(main, new Set([socket]));
  }
  object.registerSFTPAttachToken('sftp-test', '/api/sftp', main);
  object.registerProcessAttachToken('process-test', '/api/processes', main);
  const grant = await object.forwarding.create(ssh, 8080, origin, sessionId, 'isolated');
  const launchToken = new URL((await grant.json()).url).hash.slice(1).split('.')[1];
  const request = (path: string, token: string) => new Request(`https://internal/${path}`, {
    method: path === 'preview-launch' ? 'POST' : 'GET',
    headers: { 'x-preview-token': token, 'x-preview-origin': origin, 'x-preview-path': '/' },
  });
  const launch = await object.fetch(request('preview-launch', launchToken));
  assert.equal(launch.status, 200);
  const token = (await launch.json()).token;
  return { object, DB, row, main, sftp, process, delivered, storage, ticketRequest, request, token,
    failDatabase: () => { databaseFailure = true; },
    stallDatabase: () => { databaseStalled = true; },
    revoke: () => revokeWorkspaceSessions({ DB }, { accountId: row.account_id, authProvider: row.auth_provider, authRevision: row.auth_revision, accessNotBefore: 0 }),
    assertClosed() {
      assert.equal(closed, true);
      for (const socket of sockets) assert.deepEqual(socket.codes, [4001]);
      assert.equal(object.sessions.size, 0);
      assert.equal(object.sftpSessions.size, 0);
      assert.equal(object.processSessions.size, 0);
      assert.equal(object.sftpAttachTokens.size, 0);
      assert.equal(object.processAttachTokens.size, 0);
      assert.equal(object.forwarding.status().active, false);
    },
    dispose: () => object.invalidateAuthorization(),
  };
}

for (const provider of ['github', 'cloudflare']) {
  for (const role of ['main', 'sftp', 'process'] as const) {
    test(`${provider} logout blocks existing ${role} input and closes all channels`, async () => {
      const f = await fixture(provider);
      try {
        await f.object.webSocketMessage(f[role], new ArrayBuffer(1));
        assert.deepEqual(f.delivered, [role]);
        await f.revoke();
        await f.object.webSocketMessage(f[role], new ArrayBuffer(1));
        assert.deepEqual(f.delivered, [role]);
        f.assertClosed();
      } finally { f.dispose(); }
    });
  }
}

for (const path of ['preview-http', 'preview-launch', 'forward-http', 'forward', 'sftp', 'processes', 'connect']) {
  test(`revocation rejects ${path} even if the client retains its old capability`, async () => {
    const f = await fixture();
    try {
      const valid = await f.object.fetch(f.request('preview-http', f.token));
      assert.equal(valid.status, 200);
      assert.equal(await valid.text(), 'ok');
      // A disconnected management page normally retains the forwarding session.
      await f.object.webSocketClose(f.main);
      assert.equal(f.object.retainedForwarding.size, 1);
      await f.revoke();
      const req = f.request(path, f.token);
      if (!path.startsWith('preview-')) req.headers.set('x-account-id', 'owner');
      assert.equal((await f.object.fetch(req)).status, 401);
      f.assertClosed();
      assert.equal(f.object.retainedForwarding.size, 0);
    } finally { f.dispose(); }
  });
}

test('idle sessions are revoked by the periodic check without client input', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture();
  try {
    f.object.scheduleAuthorizationCheck();
    await f.revoke();
    t.mock.timers.tick(10_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    f.assertClosed();
  } finally { f.dispose(); }
});

for (const change of ['missing authorization', 'provider changed', 'database failure', 'pending connection']) {
  test(`${change} fails closed and never revives the old session`, async () => {
    const f = await fixture();
    let pendingClosed = false;
    try {
      if (change === 'missing authorization') f.storage.delete('session-authorization');
      if (change === 'provider changed') f.row.auth_provider = 'cloudflare';
      if (change === 'database failure') f.failDatabase();
      if (change === 'pending connection') {
        f.object.pendingConnections.set(f.main, { cancelled: false, closedSockets: new WeakSet(), socket: { close: async () => { pendingClosed = true; } } });
        await f.revoke();
      }
      await f.object.webSocketMessage(f.main, 'test');
      f.assertClosed();
      assert.deepEqual(f.delivered, []);
      if (change === 'pending connection') assert.equal(pendingClosed, true);
      f.row.auth_revision = 1;
      assert.equal((await f.object.fetch(f.request('preview-http', f.token))).status, 401);
    } finally { f.dispose(); }
  });
}

test('an in-flight ticket request cannot adopt the newer revision after logout', async () => {
  const f = await fixture();
  try {
    await f.revoke();
    assert.equal((await f.object.fetch(f.ticketRequest('1'))).status, 401);
    assert.equal((await f.object.fetch(f.ticketRequest('2'))).status, 409);
  } finally { f.dispose(); }
});

test('authorization lookup timeout closes idle sessions instead of retaining access indefinitely', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture();
  try {
    f.stallDatabase();
    f.object.scheduleAuthorizationCheck();
    t.mock.timers.tick(10_000);
    t.mock.timers.tick(5000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    f.assertClosed();
  } finally { f.dispose(); }
});

test('main Worker forwards the authenticated revision and ignores a forged internal header', async () => {
  const f = await fixture();
  try {
    let receivedRevision: string | null = null;
    const app = 'https://ssh.example.test';
    const env = {
      DB: f.DB, AUTH_PROVIDER: 'github', APP_ORIGIN: app,
      ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
      GH_CLIENT_ID: 'synthetic', GH_CLIENT_SECRET: 'synthetic', GH_ADMIN_ID: '123',
      SSH_SESSIONS: { newUniqueId: () => ({ toString: () => sessionId }), get: () => ({ fetch: async (req: Request) => {
        receivedRevision = req.headers.get('x-auth-revision');
        return Response.json({ ticket: 'synthetic', expiresAt: Date.now() + 60_000 });
      } }) },
    };
    const flow = await githubLogin(new Request(`${app}/auth/login`), env);
    const state = new URL(flow.headers.get('Location')).searchParams.get('state');
    const callback = await githubCallback(new Request(`${app}/auth/callback?code=synthetic&state=${state}`, {
      headers: { Cookie: flow.headers.getSetCookie()[0].split(';')[0] },
    }), env, async (url: string) => url.endsWith('access_token')
      ? Response.json({ access_token: 'synthetic' }) : Response.json({ id: 123, login: 'test' }));
    const cookie = callback.headers.getSetCookie().find((part: string) => part.startsWith('__Host-edgessh-session=')).split(';')[0];
    const response = await worker.fetch(new Request(`${app}/api/session`, { method: 'POST', body: '{}',
      headers: { Cookie: cookie, Origin: app, 'Content-Type': 'application/json', 'x-auth-revision': '999' },
    }), env);
    assert.equal(response.status, 200);
    assert.equal(receivedRevision, '1');
    const me = await worker.fetch(new Request(`${app}/api/auth/me`, { headers: { Cookie: cookie } }), env);
    assert.deepEqual((await me.json()).account, { id: 'owner', username: 'test' });
  } finally { f.dispose(); }
});

test('slow authorization reads preserve terminal input order', async () => {
  const f = await fixture();
  try {
    let firstRead!: (row: unknown) => void;
    let reads = 0;
    f.DB.prepare = () => ({ first: async () => {
      reads++;
      return reads === 1 ? new Promise((resolve) => { firstRead = resolve; }) : { ...f.row };
    } }) as any;
    const received: string[] = [];
    f.object.sessions.get(f.main).handleClientMessage = async (message: string) => { received.push(message); };
    const first = f.object.webSocketMessage(f.main, 'a');
    const second = f.object.webSocketMessage(f.main, 'b');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(reads, 1);
    assert.deepEqual(received, []);
    firstRead({ ...f.row });
    await Promise.all([first, second]);
    assert.deepEqual(received, ['a', 'b']);
  } finally { f.dispose(); }
});

test('missing D1 never enables a production authentication bypass', async () => {
  const f = await fixture();
  try {
    f.object.env.DB = undefined;
    await f.object.webSocketMessage(f.main, 'test');
    assert.deepEqual(f.delivered, []);
    f.assertClosed();
  } finally { f.dispose(); }
});

test('metadata cleanup alarm preserves an active session and its revocation binding', async () => {
  const f = await fixture();
  try {
    await f.object.alarm();
    assert.ok(f.storage.has('session-authorization'));
    assert.equal(f.storage.get('account-id'), 'owner');
    await f.revoke();
    await f.object.webSocketMessage(f.main, 'test');
    f.assertClosed();
  } finally { f.dispose(); }
});
