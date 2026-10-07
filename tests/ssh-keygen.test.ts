import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const result = await build({
  stdin: {
    contents: "export { generateEd25519KeyPair } from './frontend/src/ssh-keygen.ts'; export { SSHAuth } from './src/ssh/auth.ts';",
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'neutral', write: false,
});
const keyModule = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`) as typeof import('../frontend/src/ssh-keygen.ts') & typeof import('../src/ssh/auth.ts');

async function verifyAuth(publicKey: string, privateKey: string, passphrase?: string) {
  const publicBlob = Buffer.from(publicKey.split(' ')[1], 'base64');
  assert.equal(publicBlob.length, 51);
  assert.equal(publicBlob.readUInt32BE(0), 11);
  assert.equal(publicBlob.subarray(4, 15).toString(), 'ssh-ed25519');
  assert.equal(publicBlob.readUInt32BE(15), 32);
  const session = new Uint8Array(32);
  const packet = Buffer.from(await keyModule.SSHAuth.buildPublicKeyAuthRequest('root', privateKey, session, undefined, passphrase));
  let offset = 1;
  const read = () => { const length = packet.readUInt32BE(offset); offset += 4; const value = packet.subarray(offset, offset + length); offset += length; return value; };
  read(); read(); read(); offset++; read();
  assert.deepEqual(read(), publicBlob);
  const bodyEnd = offset;
  const signatureBlob = read();
  assert.equal(offset, packet.length);
  const key = await crypto.subtle.importKey('raw', publicBlob.subarray(19), 'Ed25519', false, ['verify']);
  const sessionLength = Buffer.alloc(4); sessionLength.writeUInt32BE(session.length);
  assert.equal(await crypto.subtle.verify('Ed25519', key, signatureBlob.subarray(19), Buffer.concat([sessionLength, session, packet.subarray(0, bodyEnd)])), true);
}

test('generated OpenSSH keys can be signed with and without a passphrase', async () => {
  const plain = await keyModule.generateEd25519KeyPair('', 'example.com', 'root');
  assert.match(plain.publicKey, /^ssh-ed25519 [A-Za-z0-9+/]+={0,2} edgessh@example\.com$/);
  await verifyAuth(plain.publicKey, plain.privateKey);

  const encrypted = await keyModule.generateEd25519KeyPair('test-passphrase', 'example.com', 'root');
  assert.match(encrypted.privateKey, /BEGIN OPENSSH PRIVATE KEY/);
  assert.notEqual(encrypted.privateKey, plain.privateKey);
  await verifyAuth(encrypted.publicKey, encrypted.privateKey, 'test-passphrase');
  await assert.rejects(
    keyModule.SSHAuth.buildPublicKeyAuthRequest('root', encrypted.privateKey, new Uint8Array(32), undefined, 'wrong-passphrase'),
    /passphrase|check integers/i,
  );
});

test('generated keys support every plain and encrypted padding boundary', async () => {
  for (const passphrase of ['', 'padding-test']) {
    for (let length = 1; length <= 16; length += 1) {
      const generated = await keyModule.generateEd25519KeyPair(passphrase, 'h'.repeat(length), 'root');
      await verifyAuth(generated.publicKey, generated.privateKey, passphrase);
    }
  }
});

test('protecting a preview key keeps the same public key', async () => {
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const plain = await keyModule.generateEd25519KeyPair('', 'example.com', 'root', pair);
  const protectedKey = await keyModule.generateEd25519KeyPair('preview-password', 'example.com', 'root', pair);
  assert.equal(protectedKey.publicKey, plain.publicKey);
  await verifyAuth(plain.publicKey, protectedKey.privateKey, 'preview-password');
});
