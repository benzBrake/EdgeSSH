import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const result = await build({
  stdin: {
    contents: `export * from './src/backend/session.ts';
      export * from './src/ssh/kex-curve25519.ts';
      export * from './src/ssh/kex-ecdh.ts';
      export * from './src/ssh/packet.ts';
      export * from './src/ssh/crypto.ts';
      export * from './src/ssh/utils.ts';`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'neutral', write: false,
});
const { SSHSession, Curve25519KeyExchange, ECDHKeyExchange,
  SSHPacketBuilder, SSHPacketParser, SSHAESGCMCipher, SSHAESCTRCipher, SSHHMAC,
  concat, encodeString } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + '\n//# sourceURL=ssh-handshake-bundle.mjs').toString('base64')}`
);

async function fixture(kex = 'curve25519-sha256', cipher = 'aes128-gcm@openssh.com', guessed = false) {
  const hostPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const hostKey = concat(encodeString('ssh-ed25519'),
    encodeString(new Uint8Array(await crypto.subtle.exportKey('raw', hostPair.publicKey))));
  const expectedFingerprint = 'SHA256:' + Buffer.from(await crypto.subtle.digest('SHA-256', hostKey)).toString('base64').replace(/=+$/, '');
  const writes: Uint8Array[] = [];
  const closes: number[] = [];
  const messages: any[] = [];
  let tcpClosed = false;
  let input!: ReadableStreamDefaultController<Uint8Array>;
  const socket = {
    writable: new WritableStream<Uint8Array>({ write: (bytes) => { writes.push(new Uint8Array(bytes)); } }),
    readable: new ReadableStream<Uint8Array>({ start: (controller) => { input = controller; } }),
    close() { tcpClosed = true; },
  };
  const ws = { readyState: WebSocket.OPEN, send: (raw: string) => messages.push(JSON.parse(raw)), close: (code: number) => closes.push(code) };
  const session = new SSHSession(ws, socket, {
    type: 'connect', host: 'example.test', port: 22, username: 'test', authMethod: 'password',
    password: 'synthetic-only', cols: 80, rows: 24, term: 'xterm', expectedFingerprint,
  });
  await session.consume(new TextEncoder().encode('SSH-2.0-test-server\r\n'));
  let sequence = 0;
  const packet = (payload: Uint8Array) => SSHPacketBuilder.build(payload, 8, null, sequence++);
  const deliver = async (payload: Uint8Array) => session.consume(await packet(payload));
  // Build the server proposal explicitly to exercise both supported KEX paths
  // and a wrong first_kex_packet_follows guess without changing production lists.
  const proposal = concat(new Uint8Array([20]), crypto.getRandomValues(new Uint8Array(16)),
    ...[guessed ? `unsupported-kex,${kex}` : kex, 'ssh-ed25519', cipher, cipher,
      'hmac-sha2-256', 'hmac-sha2-256', 'none', 'none', '', ''].map(encodeString),
    new Uint8Array([guessed ? 1 : 0, 0, 0, 0, 0]));
  const exchange = async () => {
    await deliver(proposal);
    const algorithm = kex === 'curve25519-sha256' ? Curve25519KeyExchange : ECDHKeyExchange;
    const serverPair = await algorithm.generateKeyPair();
    const serverPublic = await algorithm.exportRawPublicKey(serverPair);
    const secret = await algorithm.computeSharedSecret(serverPair.privateKey, session.clientPublic);
    const hash = await algorithm.computeExchangeHash(session.transport.getLocalVersion(), session.transport.getRemoteVersion(),
      session.localKex, proposal, hostKey, session.clientPublic, serverPublic, secret);
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', hostPair.privateKey, hash));
    return concat(new Uint8Array([31]), encodeString(hostKey), encodeString(serverPublic),
      encodeString(concat(encodeString('ssh-ed25519'), encodeString(signature))));
  };
  const rejects = async (payload: Uint8Array, error: RegExp) => {
    const before = writes.length;
    input.enqueue(await packet(payload));
    input.close();
    await session.readLoop();
    assert.equal(tcpClosed, true);
    assert.deepEqual(closes, [1011]);
    assert.match(messages.at(-1).message, error);
    assert.equal(writes.length, before, 'invalid handshake must not send another packet');
  };
  return { session, writes, deliver, packet, proposal, exchange, rejects };
}

for (const kex of ['curve25519-sha256', 'ecdh-sha2-nistp256']) {
  for (const cipher of ['aes128-gcm@openssh.com', 'aes128-ctr']) {
    test(`signed KEX reply replay closes ${kex}/${cipher} without reinitializing encryption`, async () => {
      const f = await fixture(kex, cipher);
      const reply = await f.exchange();
      await f.deliver(reply);
      assert.equal(f.writes.at(-1)![5], 21, 'client sends NEWKEYS after verifying the pinned host');
      const encryptor = f.session.encryptor;
      await f.rejects(reply, /duplicate SSH key exchange reply/);
      assert.equal(f.session.encryptor, encryptor);
    });

    test(`normal ${kex}/${cipher} handshake accepts NEWKEYS followed by encrypted service acceptance`, async () => {
      const f = await fixture(kex, cipher);
      try {
        await f.deliver(await f.exchange());
        const aead = cipher.includes('gcm');
        const Cipher = aead ? SSHAESGCMCipher : SSHAESCTRCipher;
        const keys = f.session.keys;
        const serverCipher = new Cipher(keys.encKeyServerToClient, keys.ivServerToClient);
        const clientCipher = new Cipher(keys.encKeyClientToServer, keys.ivClientToServer);
        await serverCipher.init(); await clientCipher.init();
        const serverMac = new SSHHMAC('hmac-sha2-256', keys.integrityKeyS2C);
        const clientMac = new SSHHMAC('hmac-sha2-256', keys.integrityKeyC2S);
        await serverMac.init(); await clientMac.init();
        const newKeys = await f.packet(new Uint8Array([21]));
        const service = await SSHPacketBuilder.build(concat(new Uint8Array([6]), encodeString('ssh-userauth')),
          16, (data: Uint8Array, seq: number, aad?: Uint8Array) => serverCipher.encrypt(data, seq, aad),
          3, aead, aead ? undefined : (data: Uint8Array, seq: number) => serverMac.sign(data, seq));
        const before = f.writes.length;
        await f.session.consume(concat(newKeys, service));
        const parser = new SSHPacketParser();
        // Outbound KEXINIT, ECDH_INIT and NEWKEYS preceded these encrypted packets.
        parser.seqNum = 3;
        const types: number[] = [];
        for (const bytes of f.writes.slice(before)) {
          parser.feed(bytes);
          const parsed = await parser.nextPacket(16,
            (data: Uint8Array, seq: number, aad?: Uint8Array, commit?: boolean) => clientCipher.decrypt(data, seq, aad, commit),
            aead, aead ? 0 : 32, aead ? undefined : (data: Uint8Array, mac: Uint8Array, seq: number) => clientMac.verify(data, seq, mac));
          types.push(parsed.payload[0]);
        }
        assert.deepEqual(types, [5, 50], 'service and credential requests use the negotiated encryption');
      } finally { f.session.close(true); }
    });
  }
}

test('duplicate KEXINIT is rejected before replacing the negotiated exchange', async () => {
  const f = await fixture();
  await f.exchange();
  await f.rejects(f.proposal, /duplicate SSH KEXINIT/);
});

for (const type of [21, 31]) {
  test(`out-of-order handshake message ${type} fails closed`, async () => {
    const f = await fixture();
    await f.rejects(new Uint8Array([type]), /NEWKEYS before|Unexpected.*key exchange reply/);
  });
}

for (const payload of [
  concat(new Uint8Array([80]), encodeString('audit@test'), new Uint8Array([1])),
  new Uint8Array([81]), new Uint8Array([82]), new Uint8Array([94, 0, 0, 0, 0]),
]) {
  test(`connection message ${payload[0]} cannot trigger a reply before server NEWKEYS`, async () => {
    const f = await fixture();
    await f.deliver(await f.exchange());
    await f.rejects(payload, /Unexpected SSH message during key exchange/);
  });
}

test('NEWKEYS with trailing bytes fails closed', async () => {
  const f = await fixture();
  await f.deliver(await f.exchange());
  await f.rejects(new Uint8Array([21, 0]), /Malformed SSH NEWKEYS/);
});

test('a wrong optimistic KEX guess is skipped once and the signed reply still succeeds', async () => {
  const f = await fixture('curve25519-sha256', 'aes128-gcm@openssh.com', true);
  try {
    const reply = await f.exchange();
    await f.deliver(new Uint8Array([31]));
    await f.deliver(reply);
    await f.deliver(new Uint8Array([21]));
    assert.equal(f.session.phase, 'auth');
  } finally { f.session.close(true); }
});

test('the optimistic guess exception cannot skip connection-layer messages', async () => {
  const f = await fixture('curve25519-sha256', 'aes128-gcm@openssh.com', true);
  await f.exchange();
  await f.rejects(concat(new Uint8Array([80]), encodeString('audit@test'), new Uint8Array([1])), /Expected a guessed SSH key exchange packet/);
});
