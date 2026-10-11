import assert from 'node:assert/strict';
import test from 'node:test';
import { previewDevOptions } from '../scripts/dev-preview.ts';

test('local preview derives its port and protocol from .dev.vars', () => {
  for (const port of [8788, 8318, 9000]) {
    assert.deepEqual(previewDevOptions(`DEV_AUTH=true\nPREVIEW_ORIGIN="http://127.0.0.1:${port}"`), {
      ip: '127.0.0.1', port, protocol: 'http',
    });
  }
  assert.deepEqual(previewDevOptions('DEV_AUTH=true\nPREVIEW_ORIGIN=https://preview.localhost:9443'), {
    ip: '127.0.0.1', port: 9443, protocol: 'https',
  });
  assert.deepEqual(previewDevOptions('DEV_AUTH=true\nPREVIEW_ORIGIN=http://[::1]:8788'), {
    ip: '::1', port: 8788, protocol: 'http',
  });
  assert.deepEqual(previewDevOptions('DEV_AUTH=true\nPREVIEW_ORIGIN=http://localhost'), {
    ip: '127.0.0.1', port: 80, protocol: 'http',
  });
});

test('local preview fails explicitly for missing or invalid configuration', () => {
  assert.throws(() => previewDevOptions('DEV_AUTH=true'), /PREVIEW_ORIGIN/);
  assert.throws(() => previewDevOptions('PREVIEW_ORIGIN=http://127.0.0.1:8788'), /DEV_AUTH/);
  for (const origin of ['http://example.com:8788', 'http://127.0.0.1:8788/path', 'http://127.0.0.1:8788/',
    'ftp://127.0.0.1:8788', 'http://user:password@127.0.0.1:8788']) {
    assert.throws(() => previewDevOptions(`DEV_AUTH=true\nPREVIEW_ORIGIN=${origin}`));
  }
});
