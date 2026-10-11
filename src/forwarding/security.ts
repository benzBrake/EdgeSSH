export const PREVIEW_COOKIE = '__Host-edgessh-preview';
export const DEV_PREVIEW_COOKIE = 'edgessh-preview-dev';
export const PREVIEW_PREFIX = '/__edgessh/';
export const FORWARD_TTL_MS = 60 * 60 * 1000;
export const FORWARD_RETENTION_MS = 8 * 60 * 1000;
export const LAUNCH_TTL_MS = 60_000;

// workers.dev 是公共后缀，但同账户的两个 Worker 仍共享 account.workers.dev。
// 其他域名保守比较末两段：宁可拒绝同一 co.uk 下的配置，也不误放行共享 Cookie 的域名。
function cookieSite(host: string): string {
  return host.split('.').slice(host.endsWith('.workers.dev') ? -3 : -2).join('.');
}

export function isDevelopmentPreview(url: URL, devAuth: boolean): boolean {
  return devAuth && (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
    || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
}

export function previewOrigin(value: string | undefined, appOrigin: string, devAuth = false): string {
  if (!value) throw new Error('预览 Worker 尚未配置，请先完成双 Worker 部署。');
  const preview = new URL(value.includes('://') ? value : `https://${value}`);
  const app = new URL(appOrigin);
  const local = isDevelopmentPreview(preview, devAuth);
  if (preview.hostname.endsWith('.workers.dev') && app.hostname.endsWith('.workers.dev')
    && preview.hostname.split('.').slice(-2).join('.') === app.hostname.split('.').slice(-2).join('.')) {
    throw new Error('PREVIEW_DOMAIN 与主站共享同一账户 workers.dev 站点，无法提供跨站隔离；请填写独立自定义域名。');
  }
  if ((preview.protocol !== 'https:' && !(local && preview.protocol === 'http:'))
    || preview.username || preview.password || (preview.port && !local)
    || preview.pathname !== '/' || preview.search || preview.hash
    || (!preview.hostname.includes('.') && !local) || cookieSite(preview.hostname) === cookieSite(app.hostname)) {
    throw new Error('预览域名必须是与主站不共享父域 Cookie 的独立 HTTPS 站点。');
  }
  return preview.origin;
}

export function previewError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: {
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  } });
}

export function readPreviewCookie(headers: Headers, cookieName = PREVIEW_COOKIE): string | null {
  const values = (headers.get('Cookie') ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${cookieName}=`));
  return values.length === 1 ? values[0].slice(cookieName.length + 1) : null;
}

export function parseCapability(value: string | null): { session: string; token: string } | null {
  const match = /^([a-f0-9]{64})\.([a-f0-9-]{36})$/.exec(value ?? '');
  return match ? { session: match[1], token: match[2] } : null;
}
