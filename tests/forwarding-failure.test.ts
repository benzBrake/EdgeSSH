import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
  stdin: {
    contents: `
      export { SSHSession } from './src/backend/session.ts';
      export { SSHSessionDO } from './src/backend/durable-object.ts';
      export { ForwardingError } from './src/forwarding/errors.ts';
      export { concat, encodeString, encodeUint32 } from './src/ssh/utils.ts';
    `,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'neutral', write: false,
  plugins: [{
    name: 'unused-cloudflare-socket',
    setup(build) {
      build.onResolve({ filter: /^cloudflare:sockets$/ }, () => ({ path: 'sockets', namespace: 'test' }));
      build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
        contents: "export function connect() { throw new Error('Unexpected TCP connection in test'); }",
      }));
    },
  }],
});
const { SSHSession, SSHSessionDO, ForwardingError, concat, encodeString, encodeUint32 } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const sessionId = 'a'.repeat(64);

function fixture(reasonCode: number, description: string) {
  const ws = { readyState: WebSocket.OPEN, send() {}, close() {} };
  const session = new SSHSession(ws, { close() {} }, { mode: 'forward' });
  session.phase = 'ready';
  session.sendEncrypted = async (payload: Uint8Array) => {
    if (payload[0] !== 90) return;
    const failure = concat(new Uint8Array([92]), encodeUint32(1), encodeUint32(reasonCode),
      encodeString(description), encodeString(''));
    await session.handleChannel(92, failure);
  };
  const state = {
    getWebSockets: () => [], id: { toString: () => sessionId },
    storage: { get: async () => 'account' },
  };
  const object = new SSHSessionDO(state, {});
  object.sessions.set(ws, session);
  return { session, object };
}

async function create(object: any) {
  return object.fetch(new Request('https://session.internal/forward', {
    method: 'POST', headers: { 'x-account-id': 'account', 'x-preview-origin': 'https://main.test' },
    body: JSON.stringify({ port: 8080, mode: 'trusted' }),
  }));
}

for (const [code, description, expected] of [
  [1, 'administratively prohibited', /AllowTcpForwarding/],
  [2, 'Connection refused', /远端服务拒绝连接/],
  [2, 'No route to host', /SSH 服务端无法连接远端端口/],
  [3, 'unknown channel type', /不支持 direct-tcpip/],
  [4, 'resource shortage', /资源不足/],
  [99, 'custom failure', /拒绝创建转发通道/],
] as const) {
  test(`forwarding POST preserves SSH rejection ${code}: ${description}`, async () => {
    const { session, object } = fixture(code, description);
    try {
      const response = await create(object);
      assert.equal(response.status, 502);
      const { error } = await response.json();
      assert.match(error, /127\.0\.0\.1:8080/);
      assert.match(error, expected);
      assert.match(error, new RegExp(`SSH 原因码 ${code}`));
      assert.equal(session.isForwardReady(), true);
      assert.equal(session.forwards.size, 0);
      assert.deepEqual(object.forwarding.status(), { active: false });
    } finally { session.close(true); }
  });
}

test('forwarding errors do not expose arbitrary SSH descriptions or internal exception text', async () => {
  for (const serverFailure of [true, false]) {
    const { session, object } = fixture(2, 'private-server-diagnostic');
    if (!serverFailure) session.openForward = async () => { throw new Error('private-internal-diagnostic'); };
    try {
      const response = await create(object);
      assert.equal(response.status, 502);
      assert.doesNotMatch(await response.text(), /private-/);
    } finally { session.close(true); }
  }
});

test('serving an active forwarding grant preserves a later SSH rejection', async () => {
  const { session, object } = fixture(2, 'Connection refused');
  const open = session.openForward.bind(session);
  session.openForward = async () => ({ close: async () => {} });
  try {
    assert.equal((await create(object)).status, 200);
    session.openForward = open;
    const response = await object.fetch(new Request('https://session.internal/forward-http', {
      headers: { 'x-account-id': 'account', 'x-preview-origin': 'https://main.test', 'x-preview-path': '/' },
    }));
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /127\.0\.0\.1:8080.*远端服务拒绝连接/);
  } finally { object.forwarding.clear(); session.close(true); }
});

test('malformed SSH rejection packets remain protocol errors', async () => {
  const { session } = fixture(2, 'Connection refused');
  session.sendEncrypted = async () => {};
  const opened = session.openForward(8080);
  try {
    const failure = concat(new Uint8Array([92]), encodeUint32(1), encodeUint32(2),
      encodeUint32(100), encodeString(''));
    await assert.rejects(session.handleChannel(92, failure), /Malformed channel open failure/);
    session.close(true);
    await assert.rejects(opened, (error: Error) => !(error instanceof ForwardingError));
  } finally { session.close(true); }
});
