import type { Env } from '../types.ts';
import { APIError, json, readJSON } from './http.ts';
import { DEFAULT_SETTINGS, validateSettings } from './settings-data.ts';

interface SettingsRow { settings_json: string; revision: number; updated_at: number }

export async function settingsRoute(request: Request, env: Env, accountId: string, pathname: string): Promise<Response> {
  if (pathname !== '/api/settings') throw new APIError('接口不存在。', 404);
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT settings_json, revision, updated_at FROM workspace_settings WHERE account_id = ?')
      .bind(accountId).first<SettingsRow>();
    return json(row ? { settings: validateSettings(JSON.parse(row.settings_json)), revision: row.revision, updatedAt: row.updated_at }
      : { settings: DEFAULT_SETTINGS, revision: 0, updatedAt: 0 });
  }
  if (request.method !== 'PUT') throw new APIError('不支持此请求方法。', 405);
  const body = await readJSON(request, 2048);
  if (Object.keys(body).length !== 2 || !Object.hasOwn(body, 'settings') || !Object.hasOwn(body, 'revision')) throw new APIError('请求字段无效。');
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0 || Number(body.revision) >= Number.MAX_SAFE_INTEGER) throw new APIError('设置版本无效。');
  let settings;
  try { settings = validateSettings(body.settings); }
  catch (error) { throw new APIError(error instanceof Error ? error.message : '设置格式无效。'); }
  const revision = Number(body.revision);
  const now = Date.now();
  // 创建和更新均使用原子条件写入，首次保存并发也不能覆盖另一设备。
  const result = revision === 0
    ? await env.DB.prepare('INSERT INTO workspace_settings(account_id, settings_json, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(account_id) DO NOTHING')
      .bind(accountId, JSON.stringify(settings), now).run()
    : await env.DB.prepare('UPDATE workspace_settings SET settings_json = ?, revision = revision + 1, updated_at = ? WHERE account_id = ? AND revision = ?')
      .bind(JSON.stringify(settings), now, accountId, revision).run();
  if (result.meta.changes !== 1) throw new APIError('设置已在其他设备更新，请重新加载后再保存。', 409);
  return json({ settings, revision: revision + 1, updatedAt: now });
}
