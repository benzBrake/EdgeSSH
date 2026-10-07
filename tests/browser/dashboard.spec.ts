import { test, expect, type Page } from '@playwright/test';

const host = {
  id: 'alpha', name: 'Tokyo production', host: '192.0.2.10', port: 2222, username: 'deploy',
  group: '生产环境', authMethod: 'publickey', initialCommand: 'tmux attach', termType: 'xterm-256color',
  encoding: 'utf-8', fingerprint: `SHA256:${'A'.repeat(43)}`, location: null, system: null,
  hasCredential: true, updatedAt: Date.now(),
};

async function dashboardFixture(page: Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') {
      return route.fulfill({ json: { account: { username: 'Administrator' }, provider: 'cloudflare' } });
    }
    if (path === '/api/hosts') return route.fulfill({ json: { hosts: [host] } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/');
}

test('生成预览、保护密码和使用下载始终对应同一公钥', async ({ page }) => {
  await dashboardFixture(page);
  await page.getByRole('button', { name: '编辑 Tokyo production' }).click();
  await page.locator('#generate-key').click();
  const preview = page.locator('#key-preview-dialog');
  const publicPreview = page.locator('#key-preview-public');
  await expect(publicPreview).toHaveValue(/^ssh-ed25519 /);
  const publicKey = await publicPreview.inputValue();
  expect(Buffer.from(publicKey.split(' ')[1], 'base64').length).toBe(51);
  await page.locator('#key-protect').check();
  await page.locator('#use-download-public-key').click();
  await expect(page.locator('#key-preview-error')).toContainText('请设置');
  await page.locator('#key-preview-passphrase').fill('browser-test-passphrase');
  await page.locator('#key-preview-passphrase').blur();
  await expect(publicPreview).toHaveValue(publicKey);
  const downloaded = page.waitForEvent('download');
  await page.locator('#use-download-public-key').click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString().trim()).toBe(publicKey);
  await expect(preview).toBeHidden();
  await expect(page.locator('#cloud-host-form [name="privateKeyPassphrase"]')).toHaveValue('browser-test-passphrase');
  const privateKey = await page.locator('#cloud-host-form [name="privateKey"]').inputValue();
  const raw = Buffer.from(privateKey.split('\n').slice(1, -2).join(''), 'base64');
  let offset = 15;
  const read = () => { const length = raw.readUInt32BE(offset); offset += 4; const value = raw.subarray(offset, offset + length); offset += length; return value; };
  expect(read().toString()).toBe('aes256-ctr'); read(); read(); offset += 4;
  expect(read().toString('base64')).toBe(publicKey.split(' ')[1]);
  await page.locator('#cloud-host-form [name="authMethod"]').selectOption('password');
  await expect(page.locator('#cloud-host-form [name="privateKey"]')).toHaveValue('');
  await expect(page.locator('#cloud-host-form [name="privateKeyPassphrase"]')).toHaveValue('');
});

test('无密码生成并复制使用预览中的公钥', async ({ page }) => {
  await dashboardFixture(page);
  await page.getByRole('button', { name: '编辑 Tokyo production' }).click();
  await page.locator('#generate-key').click();
  await expect(page.locator('#key-preview-public')).toHaveValue(/^ssh-ed25519 /);
  const publicKey = await page.locator('#key-preview-public').inputValue();
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'writeText', { value: async (value: string) => { document.body.dataset.copiedPublicKey = value; } }); });
  await page.locator('#use-copy-public-key').click();
  await expect(page.locator('#key-preview-dialog')).toBeHidden();
  expect(await page.evaluate(() => document.body.dataset.copiedPublicKey)).toBe(publicKey);
  const privateKey = await page.locator('#cloud-host-form [name="privateKey"]').inputValue();
  const raw = Buffer.from(privateKey.split('\n').slice(1, -2).join(''), 'base64');
  expect(raw.subarray(19, 23).toString()).toBe('none');
  await expect(page.locator('#cloud-host-form [name="privateKeyPassphrase"]')).toHaveValue('');
  await expect(page.locator('#cloud-host-form [name="clearPrivateKeyPassphrase"]')).toBeChecked();
});

test('取消生成和复制失败均保留原私钥', async ({ page }) => {
  await dashboardFixture(page);
  await page.getByRole('button', { name: '编辑 Tokyo production' }).click();
  const privateInput = page.locator('#cloud-host-form [name="privateKey"]');
  await privateInput.fill('existing-test-key');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#generate-key').click();
  await expect(page.locator('#key-preview-dialog')).toBeHidden();
  await expect(privateInput).toHaveValue('existing-test-key');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#generate-key').click();
  await expect(page.locator('#key-preview-public')).toHaveValue(/^ssh-ed25519 /);
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'writeText', { value: async () => { throw new Error('clipboard unavailable'); } }); });
  await page.locator('#use-copy-public-key').click();
  await expect(page.locator('#key-preview-error')).toContainText('clipboard unavailable');
  await expect(privateInput).toHaveValue('existing-test-key');
  await page.locator('#key-preview-dialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(privateInput).toHaveValue('existing-test-key');
});

test('主机列表编辑打开正确弹窗并回填资料', async ({ page }) => {
  await dashboardFixture(page);

  await page.getByRole('button', { name: '编辑 Tokyo production' }).click();

  const editor = page.getByRole('dialog', { name: '编辑主机' });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('名称')).toHaveValue(host.name);
  await expect(editor.getByLabel('主机地址')).toHaveValue(host.host);
  await expect(editor.getByLabel('SSH 用户名')).toHaveValue(host.username);
  await expect(editor.getByLabel('端口')).toHaveValue(String(host.port));
  await expect(editor.locator('select[name="authMethod"]')).toHaveValue(host.authMethod);
  await expect(editor.locator('textarea[name="privateKey"]')).toHaveValue('');
  await expect(page.locator('dialog[aria-labelledby="forward-key-heading"]')).not.toHaveAttribute('open', '');

  await editor.getByRole('button', { name: '取消' }).click();
  await expect(editor).toBeHidden();
  await page.getByRole('button', { name: '编辑 Tokyo production' }).click();
  await expect(editor).toBeVisible();
});

test('进入工作台后顶栏导航不重叠或产生横向溢出', async ({ page }) => {
  await dashboardFixture(page);

  await page.getByRole('button', { name: '连接', exact: true }).click();
  await expect(page.locator('body[data-view="workspace"]')).toBeVisible();

  const layout = await page.evaluate(() => {
    const topbar = document.querySelector<HTMLElement>('.topbar')!;
    const actions = document.querySelector<HTMLElement>('.topbar-actions')!;
    const buttons = [...document.querySelectorAll<HTMLElement>('.topbar-actions .home-back')];
    const rects = buttons.map((button) => button.getBoundingClientRect());
    return {
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      topbarWidth: topbar.scrollWidth,
      actionsWidth: actions.scrollWidth,
      rects: rects.map(({ left, right, width }) => ({ left, right, width })),
    };
  });

  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.topbarWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.actionsWidth).toBeLessThanOrEqual(layout.viewportWidth);
  for (let index = 1; index < layout.rects.length; index += 1) {
    expect(layout.rects[index].left).toBeGreaterThanOrEqual(layout.rects[index - 1].right);
  }
});

test('会话 Tab 与主机总览之间切换不会重复发送终端 resize', async ({ page }) => {
  const calls: Array<Record<string, unknown>> = [];
  const hostWrites: string[] = [];
  const host = {
    id: 'alpha', name: 'Tokyo production', host: '192.0.2.10', port: 22, username: 'root',
    group: '生产环境', authMethod: 'password', initialCommand: '', termType: 'xterm-256color',
    encoding: 'utf-8', fingerprint: '', location: null, system: null, hasCredential: true, updatedAt: Date.now(),
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { account: { username: 'Administrator' }, provider: 'local-dev' } });
    if (path === '/api/hosts') {
      if (route.request().method() !== 'GET') hostWrites.push(route.request().method());
      return route.fulfill({ json: { hosts: [host] } });
    }
    if (path.endsWith('/credentials')) return route.fulfill({ json: { password: 'test-password' } });
    if (path === '/api/session') return route.fulfill({ json: { ticket: 'test-ticket', sessionId: 'test-session' } });
    return route.fulfill({ json: {} });
  });
  await page.routeWebSocket('**/api/ssh?*', (ws) => {
    ws.onMessage((raw) => {
      if (typeof raw !== 'string') return;
      const message = JSON.parse(raw) as Record<string, unknown>;
      calls.push(message);
      if (message.type === 'connect') ws.send(JSON.stringify({ type: 'ready' }));
    });
  });
  await page.goto('/');

  await page.locator('#host-list').getByRole('button', { name: '连接', exact: true }).click();
  await expect.poll(() => calls.some((message) => message.type === 'connect')).toBe(true);
  await expect.poll(() => hostWrites).toEqual([]);
  await expect(page.locator('.session-tab')).toHaveCount(1);
  await page.waitForTimeout(300);
  const resizeCount = () => calls.filter((message) => message.type === 'resize').length;
  const baseline = resizeCount();

  await page.locator('#session-home').click();
  await page.waitForTimeout(300);
  await page.locator('.session-tab').click();
  await page.waitForTimeout(500);

  expect(resizeCount()).toBe(baseline);
});

test('会话终端中的管理代码片段可打开管理页并返回工作台', async ({ page }) => {
  const host = {
    id: 'alpha', name: 'Tokyo production', host: '192.0.2.10', port: 22, username: 'root',
    group: '生产环境', authMethod: 'password', initialCommand: '', termType: 'xterm-256color',
    encoding: 'utf-8', fingerprint: '', location: null, system: null, hasCredential: true, updatedAt: Date.now(),
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { account: { username: 'Administrator' }, provider: 'local-dev' } });
    if (path === '/api/hosts') return route.fulfill({ json: { hosts: [host] } });
    if (path.endsWith('/credentials')) return route.fulfill({ json: { password: 'test-password' } });
    if (path === '/api/session') return route.fulfill({ json: { ticket: 'test-ticket', sessionId: 'test-session' } });
    if (path === '/api/snippets') return route.fulfill({ json: { snippets: [] } });
    return route.fulfill({ json: {} });
  });
  await page.routeWebSocket('**/api/ssh?*', (ws) => {
    ws.onMessage((raw) => {
      if (typeof raw !== 'string') return;
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === 'connect') ws.send(JSON.stringify({ type: 'ready' }));
    });
  });
  await page.goto('/');
  await page.locator('#host-list').getByRole('button', { name: '连接', exact: true }).click();
  await expect(page.locator('.session-tab')).toHaveCount(1);

  const session = page.frameLocator('.session-frame-host iframe');
  await expect(session.locator('#snippet-panel')).toBeVisible();
  const expand = session.getByRole('button', { name: '展开代码片段' });
  if (await expand.count()) await expand.click();
  await session.getByRole('button', { name: '管理代码片段', exact: true }).click();
  await expect(session.locator('#snippets-page')).toBeVisible();
  await expect(session.getByRole('heading', { name: '代码片段', exact: true })).toBeVisible();
  await expect(page.locator('#session-home')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.session-tab')).toHaveAttribute('aria-selected', 'false');

  await session.getByRole('button', { name: '返回终端', exact: true }).click();
  await expect(page.locator('#session-home')).not.toHaveAttribute('aria-current', 'page');
  await expect(session.locator('#app')).toBeVisible();

  const panelAfterReturn = session.locator('#snippet-panel');
  const expandAfterReturn = session.getByRole('button', { name: '展开代码片段' });
  if (await expandAfterReturn.count()) await expandAfterReturn.click();
  await panelAfterReturn.getByRole('button', { name: '管理代码片段', exact: true }).click();
  await expect(page.locator('#session-home')).toHaveAttribute('aria-current', 'page');

  await page.locator('.session-tab').click();
  await expect(page.locator('#session-home')).not.toHaveAttribute('aria-current', 'page');
  await expect(session.locator('#app')).toBeVisible();
  await expect(session.locator('#terminal-card')).toBeVisible();
});
