import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { Env } from '../src/types.ts';
import { APIError } from '../src/accounts/http.ts';
import { settingsRoute } from '../src/accounts/settings.ts';
import { DEFAULT_SETTINGS, validateSettings, validateSettingsSnapshot, type SettingsSnapshot } from '../src/accounts/settings-data.ts';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of ['0001_accounts', '0002_workspace_state', '0003_snippets', '0004_forward_rules']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'));
  }
  sqlite.prepare('INSERT INTO hosts VALUES (?, ?, ?, ?)').run('existing-host', 'owner', 'existing-encrypted-payload', 123);
  sqlite.exec(readFileSync(new URL('../migrations/0005_workspace_settings.sql', import.meta.url), 'utf8'));
  const env = { DB: { prepare(sql: string) {
    const query = sqlite.prepare(sql);
    let params: (string | number)[] = [];
    const statement = {
      bind(...values: (string | number)[]) { params = values; return statement; },
      async first() { return query.get(...params) ?? null; },
      async run() { return { meta: { changes: Number(query.run(...params).changes) } }; },
    };
    return statement;
  } } } as unknown as Env;
  const request = (method = 'GET', body?: unknown, owner = 'owner', path = '/api/settings', contentType = 'application/json') => settingsRoute(new Request(`https://example.com${path}`, {
    method, headers: { 'Content-Type': contentType }, body: body === undefined ? undefined : JSON.stringify(body),
  }), env, owner, path);
  const read = async (owner = 'owner') => await (await request('GET', undefined, owner)).json() as SettingsSnapshot;
  return { sqlite, request, read };
}

test('迁移保留原有主机；首次读取返回默认值且不写数据库', async (context) => {
  const f = fixture(); context.after(() => f.sqlite.close());
  assert.deepEqual(await f.read(), { settings: DEFAULT_SETTINGS, revision: 0, updatedAt: 0 });
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_settings').get()!.count, 0);
  assert.equal(f.sqlite.prepare('SELECT encrypted_payload FROM hosts').get()!.encrypted_payload, 'existing-encrypted-payload');
  assert.equal(f.sqlite.prepare('SELECT account_id FROM workspace_state').get()!.account_id, 'admin');
});

test('保存、再次读取、版本递增和工作区隔离', async (context) => {
  const f = fixture(); context.after(() => f.sqlite.close());
  const settings = { ...DEFAULT_SETTINGS, fontSize: 24, cursorStyle: 'bar', cursorBlink: false, sshEditorDefaultOpen: false, collapsedSnippetAction: 'terminal' };
  const saved = await (await f.request('PUT', { settings, revision: 0 })).json() as SettingsSnapshot;
  assert.equal(saved.revision, 1); assert.ok(saved.updatedAt > 0);
  assert.deepEqual(saved.settings, settings); assert.deepEqual(await f.read(), saved);
  assert.equal((await f.read('other')).revision, 0);
  await f.request('PUT', { settings: DEFAULT_SETTINGS, revision: 0 }, 'other');
  assert.deepEqual((await f.read()).settings, settings);
  await f.request('PUT', { settings: DEFAULT_SETTINGS, revision: 1 });
  assert.equal((await f.read()).revision, 2);
  assert.deepEqual((await f.read()).settings, DEFAULT_SETTINGS);
});

test('并发首次保存与过期版本均返回 409，不覆盖已保存设置', async (context) => {
  const f = fixture(); context.after(() => f.sqlite.close());
  const results = await Promise.allSettled([f.request('PUT', { settings: DEFAULT_SETTINGS, revision: 0 }), f.request('PUT', { settings: { ...DEFAULT_SETTINGS, fontSize: 20 }, revision: 0 })]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof APIError); assert.equal(rejected.reason.status, 409);
  await f.request('PUT', { settings: { ...DEFAULT_SETTINGS, fontSize: 18 }, revision: 1 });
  await assert.rejects(f.request('PUT', { settings: DEFAULT_SETTINGS, revision: 1 }), (error: APIError) => error.status === 409);
  assert.equal((await f.read()).settings.fontSize, 18);
  await assert.rejects(f.request('PUT', { settings: DEFAULT_SETTINGS, revision: 1 }, 'missing'), (error: APIError) => error.status === 409);
});

test('严格拒绝非法设置、版本、字段、请求方法及超长请求', async (context) => {
  const f = fixture(); context.after(() => f.sqlite.close());
  for (const settings of [null, [], {}, { ...DEFAULT_SETTINGS, extra: true }, { ...DEFAULT_SETTINGS, fontSize: '13' },
    { ...DEFAULT_SETTINGS, fontSize: 9 }, { ...DEFAULT_SETTINGS, fontSize: 25 }, { ...DEFAULT_SETTINGS, fontSize: 13.5 },
    { ...DEFAULT_SETTINGS, cursorStyle: 'beam' }, { ...DEFAULT_SETTINGS, cursorBlink: 'false' },
    { ...DEFAULT_SETTINGS, sshEditorDefaultOpen: 1 }, { ...DEFAULT_SETTINGS, collapsedSnippetAction: 'run' }]) {
    assert.throws(() => validateSettings(settings));
    await assert.rejects(f.request('PUT', { settings, revision: 0 }), (error: APIError) => error.status === 400);
  }
  for (const revision of [-1, 0.5, '0', null, Number.MAX_SAFE_INTEGER]) await assert.rejects(f.request('PUT', { settings: DEFAULT_SETTINGS, revision }));
  await assert.rejects(f.request('PUT', { settings: DEFAULT_SETTINGS, revision: 0, accountId: 'other' }));
  await assert.rejects(f.request('POST'), (error: APIError) => error.status === 405);
  await assert.rejects(f.request('GET', undefined, 'owner', '/api/settings/extra'), (error: APIError) => error.status === 404);
  await assert.rejects(f.request('PUT', {}, 'owner', '/api/settings', 'text/plain'), (error: APIError) => error.status === 415);
  await assert.rejects(f.request('PUT', { padding: 'x'.repeat(2048) }), (error: APIError) => error.status === 413);
  assert.throws(() => validateSettingsSnapshot({ settings: DEFAULT_SETTINGS, revision: -1, updatedAt: 0 }));
});

test('损坏的数据库设置显式失败，不返回默认值掩盖损坏', async (context) => {
  const f = fixture(); context.after(() => f.sqlite.close());
  f.sqlite.prepare('INSERT INTO workspace_settings VALUES (?, ?, ?, ?)').run('owner', '{}', 1, 123);
  await assert.rejects(f.read(), /设置字段/);
});
