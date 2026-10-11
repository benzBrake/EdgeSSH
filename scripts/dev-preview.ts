import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { isDevelopmentPreview, previewOrigin } from '../src/forwarding/security.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));

export function previewDevOptions(contents: string): { ip: string; port: number; protocol: 'http' | 'https' } {
  const { PREVIEW_ORIGIN, DEV_AUTH } = parseEnv(contents);
  if (DEV_AUTH !== 'true') throw new Error('本地预览需要在 .dev.vars 设置 DEV_AUTH=true。');
  if (!PREVIEW_ORIGIN) throw new Error('请在 .dev.vars 设置 PREVIEW_ORIGIN=http://localhost:8788，主站用 http://127.0.0.1:8787 打开。');
  let url: URL;
  try { url = new URL(PREVIEW_ORIGIN); }
  catch { throw new Error('PREVIEW_ORIGIN 地址无效，例如应为 http://localhost:8788。'); }
  if (!isDevelopmentPreview(url, true)) throw new Error('本地预览监听地址必须使用回环域名或 IP。');
  previewOrigin(PREVIEW_ORIGIN, 'https://app.example.invalid', true);
  if (PREVIEW_ORIGIN !== url.origin) throw new Error('PREVIEW_ORIGIN 只填协议、地址和端口，不带路径或末尾斜杠。');
  return {
    ip: url.hostname === '[::1]' ? '::1' : '127.0.0.1',
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    protocol: url.protocol === 'https:' ? 'https' : 'http',
  };
}

async function main(): Promise<void> {
  const options = previewDevOptions(await readFile(new URL('../.dev.vars', import.meta.url), 'utf8'));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [wrangler, 'dev', '--local', '--config', 'wrangler.preview.local.toml',
      '--ip', options.ip, '--port', String(options.port), '--local-protocol', options.protocol], {
      cwd: root,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal === 'SIGINT') resolve();
      else if (code === 0) resolve();
      else reject(new Error(`本地预览 Worker 已退出（退出码 ${code}）。`));
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
