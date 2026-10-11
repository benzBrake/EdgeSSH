import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const result = await build({
  stdin: { contents: "export { SFTPHandler } from './src/backend/sftp-handler.ts'; export { SFTPClient } from './src/ssh/sftp.ts';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'neutral', write: false,
});
const { SFTPHandler, SFTPClient } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const path = '/root/example.conf';
const attrs = () => ({ flags: 0, size: 5, uid: 1000, gid: 1000, permissions: 0o100640, mtime: 123 });

function fixture() {
  const files = new Map<string, Uint8Array>([[path, Buffer.from('hello')]]);
  const metadata = new Map<string, ReturnType<typeof attrs>>([[path, attrs()]]);
  const messages: Record<string, any>[] = [];
  const binary: Uint8Array[] = [];
  let failMetadata = false;
  let failRename = false;
  const client = {
    async lstat(name: string) { const value = metadata.get(name); if (!value) throw new Error('No such file'); return value; },
    async openFile(name: string, flags: number, requested?: { permissions?: number }) {
      if (flags & 0x20) {
        if (files.has(name)) throw new Error('File already exists');
        files.set(name, new Uint8Array());
        metadata.set(name, { ...attrs(), size: 0, permissions: 0o100000 | (requested?.permissions ?? 0o600) });
      }
      return new TextEncoder().encode(name);
    },
    async readFile(handle: Uint8Array, offset: number, length: number) {
      const data = files.get(new TextDecoder().decode(handle))!;
      return offset < data.length ? data.subarray(offset, offset + length) : null;
    },
    async writeFile(handle: Uint8Array, offset: number, data: Uint8Array) {
      const name = new TextDecoder().decode(handle);
      const original = files.get(name)!;
      const next = new Uint8Array(Math.max(original.length, offset + data.length));
      next.set(original); next.set(data, offset); files.set(name, next);
      metadata.set(name, { ...metadata.get(name)!, size: next.length });
    },
    async fstat(handle: Uint8Array) { return metadata.get(new TextDecoder().decode(handle))!; },
    async fsetstat(handle: Uint8Array, requested: { uid?: number; gid?: number; permissions?: number }) {
      if (failMetadata) throw new Error('FSETSTAT refused');
      const name = new TextDecoder().decode(handle);
      metadata.set(name, { ...metadata.get(name)!, ...requested,
        permissions: requested.permissions === undefined ? metadata.get(name)!.permissions : 0o100000 | requested.permissions });
    },
    async closeHandle() {},
    async removeFile(name: string) { files.delete(name); metadata.delete(name); },
    async rename(from: string, to: string) {
      if (failRename) throw new Error('RENAME refused');
      files.set(to, files.get(from)!); metadata.set(to, metadata.get(from)!);
      files.delete(from); metadata.delete(from);
    },
  };
  const handler = new SFTPHandler({} as never, async () => {}, (message: Record<string, any>) => messages.push(message), (data: Uint8Array) => binary.push(data));
  handler.ready = true;
  handler.client = client;
  return { handler, files, metadata, messages, binary,
    setFailMetadata(value: boolean) { failMetadata = value; },
    setFailRename(value: boolean) { failRename = value; } };
}

test('text save checks content twice and cleans a temporary file after a conflict', async () => {
  const f = fixture();
  await f.handler.startUpload('start-conflict', path, 5, true, digest(Buffer.from('wrong')), true);
  assert.equal(f.messages.at(-1)?.reason, 'conflict');
  assert.equal([...f.files.keys()].length, 1);

  await f.handler.startUpload('late-conflict', path, 5, true, digest(Buffer.from('hello')), true);
  assert.equal(f.messages.at(-1)?.type, 'sftp_upload_ready');
  await f.handler.uploadChunk(Buffer.from('draft'));
  f.files.set(path, Buffer.from('other'));
  await f.handler.finishUpload('late-conflict');
  assert.equal(f.messages.at(-1)?.reason, 'conflict');
  assert.equal(Buffer.from(f.files.get(path)!).toString(), 'other');
  assert.deepEqual([...f.files.keys()], [path]);
});

test('metadata and rename failures keep the original file and clean the temporary file', async () => {
  for (const failure of ['metadata', 'rename']) {
    const f = fixture();
    await f.handler.startUpload('save', path, 5, true, digest(Buffer.from('hello')), true);
    const temporary = [...f.files.keys()].find(name => name !== path)!;
    if (failure === 'metadata') {
      f.metadata.set(temporary, { ...f.metadata.get(temporary)!, uid: 2000 });
      f.setFailMetadata(true);
    } else f.setFailRename(true);
    await f.handler.uploadChunk(Buffer.from('draft'));
    await f.handler.finishUpload('save');
    assert.equal(f.messages.at(-1)?.type, 'sftp_error');
    assert.equal(Buffer.from(f.files.get(path)!).toString(), 'hello');
    assert.deepEqual([...f.files.keys()], [path]);
  }
});

test('strict metadata save succeeds and text preview enforces the size limit', async () => {
  const f = fixture();
  await f.handler.startUpload('save', path, 5, true, digest(Buffer.from('hello')), true);
  await f.handler.uploadChunk(Buffer.from('draft'));
  await f.handler.finishUpload('save');
  assert.equal(f.messages.at(-1)?.type, 'sftp_upload_complete');
  assert.equal(Buffer.from(f.files.get(path)!).toString(), 'draft');
  assert.equal(f.metadata.get(path)!.permissions, 0o100640);
  const larger = new Uint8Array(1024 * 1024 + 1);
  f.files.set(path, larger);
  f.metadata.set(path, { ...attrs(), size: larger.length });
  await f.handler.download('preview', path, 1024 * 1024);
  assert.equal(f.messages.at(-1)?.type, 'sftp_error');
  assert.equal(f.binary.length, 0);
});

test('SFTP v3 encodes LSTAT, FSTAT and FSETSTAT requests', async () => {
  const sent: Uint8Array[] = [];
  let client: InstanceType<typeof SFTPClient>;
  const uint32 = (value: number) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value);
    return bytes;
  };
  const packet = (type: number, id: number, payload: Uint8Array) => {
    const body = new Uint8Array([type, ...uint32(id), ...payload]);
    return new Uint8Array([...uint32(body.length), ...body]);
  };
  client = new SFTPClient((data: Uint8Array) => {
    sent.push(data);
    const type = data[4];
    queueMicrotask(() => {
      if (type === 1) client.feed(new Uint8Array([...uint32(5), 2, ...uint32(3)]));
      else {
        const id = new DataView(data.buffer, data.byteOffset + 5, 4).getUint32(0);
        client.feed(type === 10
          ? packet(101, id, new Uint8Array([...uint32(0), ...uint32(0), ...uint32(0)]))
          : packet(105, id, new Uint8Array([...uint32(4), ...uint32(0o100640)])));
      }
    });
  });
  await client.initialize();
  assert.equal((await client.lstat(path)).permissions, 0o100640);
  assert.equal((await client.fstat(new Uint8Array([1]))).permissions, 0o100640);
  await client.fsetstat(new Uint8Array([1]), { permissions: 0o640 });
  assert.deepEqual(sent.map(data => data[4]), [1, 7, 8, 10]);
  const fset = sent.at(-1)!;
  assert.equal(new DataView(fset.buffer, fset.byteOffset + 14, 4).getUint32(0), 4);
  assert.equal(new DataView(fset.buffer, fset.byteOffset + 18, 4).getUint32(0), 0o640);
  client.dispose();
});
