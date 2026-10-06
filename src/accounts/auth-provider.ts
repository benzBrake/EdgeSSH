import type { Env } from '../types.ts';
import { APIError } from './http.ts';

export type AuthProvider = 'cloudflare' | 'github' | 'local-dev';

export function authProvider(env: Pick<Env, 'AUTH_PROVIDER' | 'DEV_AUTH'>): AuthProvider {
  if (env.DEV_AUTH === 'true') return 'local-dev';
  const provider = env.AUTH_PROVIDER || 'cloudflare';
  if (provider !== 'cloudflare' && provider !== 'github') throw new APIError('管理员尚未正确配置登录方式。', 503);
  return provider;
}
