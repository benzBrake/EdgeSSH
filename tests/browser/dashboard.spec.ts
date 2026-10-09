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
      return route.fulfill({ json: { account: { username: 'local-development' }, provider: 'local-dev' } });
    }
    if (path === '/api/hosts') return route.fulfill({ json: { hosts: [host] } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/');
}

test('已保存主机删除需要确认，弹窗在大屏双列、小屏单列显示', async ({ page }) => {
  await dashboardFixture(page);
  let hosts = [host, { ...host, id: 'beta', name: 'Backup server', host: '192.0.2.11' }];
  const deleted: string[] = [];
  await page.route('**/api/hosts**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'DELETE') {
      deleted.push(path);
      hosts = hosts.filter((entry) => path !== `/api/hosts/${entry.id}`);
      return route.fulfill({ json: { ok: true } });
    }
    if (path === '/api/hosts') return route.fulfill({ json: { hosts } });
    return route.fulfill({ json: {} });
  });
  await page.locator('#session-new').click();
  const session = page.frameLocator('.session-frame-host iframe');
  const panel = session.locator('#connection-panel');
  const cards = session.locator('#profile-list .profile-card');
  await expect(panel).toBeVisible();
  await expect(cards).toHaveCount(2);
  await expect(cards.first().locator('strong')).toHaveText(host.name);
  await expect(cards.first().locator('.profile-address')).toHaveText('deploy@192.0.2.10:2222');
  await expect(cards.first().locator('.profile-system svg')).toBeVisible();
  await panel.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const firstBounds = (await cards.nth(0).boundingBox())!;
  const secondBounds = (await cards.nth(1).boundingBox())!;
  if (page.viewportSize()!.width > 760) {
    expect(secondBounds.y).toBe(firstBounds.y);
    expect(secondBounds.x).toBeGreaterThan(firstBounds.x);
  } else {
    expect(secondBounds.x).toBe(firstBounds.x);
    expect(secondBounds.y).toBeGreaterThan(firstBounds.y);
  }
  const panelBounds = (await panel.boundingBox())!;
  expect(panelBounds.height).toBeGreaterThanOrEqual(520);
  expect(panelBounds.x).toBeGreaterThanOrEqual(0);
  expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  const remove = session.getByRole('button', { name: `删除 ${host.name}`, exact: true });
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toContain(host.name);
    expect(dialog.message()).toContain('保存的凭据');
    await dialog.dismiss();
  });
  await remove.click();
  await expect(cards).toHaveCount(2);
  expect(deleted).toEqual([]);
  page.once('dialog', (dialog) => dialog.accept());
  await remove.click();
  await expect(cards).toHaveCount(1);
  expect(deleted).toEqual(['/api/hosts/alpha']);
  await expect(cards.first().locator('strong')).toHaveText('Backup server');
});

test('首页切换暗色模式时只更新会话栏主题', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('workers-webssh.theme', 'light'));
  await dashboardFixture(page);

  const sessionBar = page.locator('#session-tabs');
  const homeTab = page.locator('#session-home');
  const dashboard = page.locator('#dashboard');
  const lightBarBackground = await sessionBar.evaluate((element) => getComputedStyle(element).backgroundColor);
  const lightHomeTabColor = await homeTab.evaluate((element) => getComputedStyle(element).color);
  const lightDashboardBackground = await dashboard.evaluate((element) => getComputedStyle(element).backgroundColor);

  if (page.viewportSize()!.width <= 600) await page.locator('#session-menu-toggle').click();
  await page.locator('#theme-toggle').click();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => sessionBar.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(lightBarBackground);
  await expect.poll(() => homeTab.evaluate((element) => getComputedStyle(element).color)).toBe('rgb(244, 81, 30)');
  expect(await homeTab.evaluate((element) => getComputedStyle(element).color)).not.toBe(lightHomeTabColor);
  await expect.poll(() => dashboard.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(lightDashboardBackground);
});

test('账户入口跟随当前语言显示', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('workers-webssh.language', 'en'));
  await dashboardFixture(page);

  const account = page.locator('#account-action');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#account-label')).toHaveText('Sign out (local-development)');
  await expect(account).toHaveAttribute('aria-label', 'Sign out (local-development)');
  await expect(account).toHaveAttribute('title', 'Sign out (local-development)');
});

test('会话栏在无会话和关闭最后一个会话后常驻显示', async ({ page }) => {
  await dashboardFixture(page);
  const bar = page.locator('#session-tabs');
  const home = page.locator('#session-home');
  const expectEmptyHome = async () => {
    await expect(bar).toBeVisible();
    await expect(home).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.session-tab')).toHaveCount(0);
    await expect(page.locator('#session-new')).toBeVisible();
    if (page.viewportSize()!.width <= 600) {
      await expect(page.locator('#session-menu-toggle')).toBeVisible();
      await expect(page.locator('#theme-toggle')).toBeHidden();
      await expect(page.locator('#session-language-toggle')).toBeHidden();
    } else {
      await expect(page.locator('#session-menu-toggle')).toBeHidden();
      await expect(page.locator('#theme-toggle')).toBeVisible();
      await expect(page.locator('#session-language-toggle')).toBeVisible();
    }
    await expect(page.locator('#session-scroll-left')).toBeHidden();
    await expect(page.locator('#session-scroll-right')).toBeHidden();
    const barBounds = await bar.boundingBox();
    const headerBounds = await page.locator('#dashboard .home-header').boundingBox();
    expect(headerBounds!.y).toBeGreaterThanOrEqual(barBounds!.y + barBounds!.height);
  };
  await expectEmptyHome();
  await expect(page.locator('#account-login-icon')).toBeHidden();
  if (page.viewportSize()!.width <= 600) await expect(page.locator('#account-logout-icon')).toBeHidden();
  else await expect(page.locator('#account-logout-icon')).toBeVisible();

  await page.locator('#session-new').click();
  await expect(page.locator('.session-tab')).toHaveCount(1);
  await expect(home).not.toHaveAttribute('aria-current', 'page');
  const session = page.frameLocator('.session-frame-host iframe');
  await expect(session.locator('#connection-panel')).toBeVisible();
  await expect(session.locator('#session-tabs')).toBeHidden();

  await page.locator('.session-tab-close').click();
  await expect(page.locator('#session-frame-host')).toBeHidden();
  await expectEmptyHome();
});

test('加号单击新建 SSH，长按与键盘菜单选择 SFTP', async ({ page }) => {
  await dashboardFixture(page);
  const add = page.locator('#session-new');
  await add.click();
  await expect(page.locator('.session-tab')).toHaveAttribute('data-session-kind', 'ssh');
  await expect(page.frameLocator('.session-frame-host iframe').getByRole('heading', { name: 'SSH 工作台' })).toBeVisible();
  await page.locator('.session-tab-close').click();
  await expect(page.locator('.session-tab')).toHaveCount(0);
  await add.dispatchEvent('pointerdown', { button: 0, clientX: 100, clientY: 20 });
  const menu = page.locator('#session-create-menu');
  await expect(menu).toBeVisible();
  await add.dispatchEvent('pointerup');
  await add.dispatchEvent('click');
  await expect(page.locator('.session-tab')).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'SFTP 工作台' }).click();
  await expect(page.locator('.session-tab')).toHaveAttribute('data-session-kind', 'sftp');
  await expect(page.frameLocator('.session-frame-host iframe').getByRole('heading', { name: 'SFTP 工作台' })).toBeVisible();
  await page.locator('.session-tab-close').click();
  await expect(page.locator('.session-tab')).toHaveCount(0);
  await add.focus();
  await add.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'SSH 工作台' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'SFTP 工作台' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(add).toBeFocused();
  await add.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(page.locator('.session-tab')).toHaveAttribute('data-session-kind', 'sftp');
});

test('窄屏会话操作收进三道杠菜单', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 812 });
  await dashboardFixture(page);

  const toggle = page.locator('#session-menu-toggle');
  const menu = page.locator('#session-button-group');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(menu).toBeVisible();
  const menuBounds = await menu.boundingBox();
  for (const action of await menu.locator('button, a').all()) {
    await action.hover();
    const actionBounds = await action.boundingBox();
    expect(actionBounds!.x).toBeGreaterThanOrEqual(menuBounds!.x);
    expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(menuBounds!.x + menuBounds!.width);
    expect(await action.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(await action.evaluate((element) => element.clientWidth));
  }
  const labelOffsets = await menu.locator('.session-menu-label').evaluateAll((labels) => labels.map((label) => label.getBoundingClientRect().left));
  expect(new Set(labelOffsets.map((offset) => Math.round(offset))).size).toBe(1);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await page.locator('#session-language-toggle').click();
  await expect(page.locator('#language-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#language-menu')).toBeHidden();
  await expect(menu).toBeVisible();

  await page.setViewportSize({ width: 601, height: 812 });
  await expect(toggle).toBeHidden();
  await expect(menu).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

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
    const topbar = document.querySelector<HTMLElement>('#session-tabs')!;
    const actions = document.querySelector<HTMLElement>('#session-button-group')!;
    const buttons = [...topbar.children].filter((element): element is HTMLElement =>
      element instanceof HTMLElement && getComputedStyle(element).position !== 'absolute' && element.getBoundingClientRect().width > 0);
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


test('会话标签溢出使用箭头，滚轮切换并显示选中标签', async ({ page }) => {
  await page.route('**/*sessionFrame=1*', (route) => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await dashboardFixture(page);
  await page.locator('#host-list').getByRole('button', { name: '连接', exact: true }).click();
  await expect(page.locator('.session-tab')).toHaveCount(1);
  await expect(page.locator('#session-scroll-left')).toBeHidden();
  await expect(page.locator('#session-scroll-right')).toBeHidden();
  for (let i = 0; i < 7; i++) await page.locator('#session-new').click();
  await expect(page.locator('.session-tab')).toHaveCount(8);
  await expect(page.locator('#session-scroll-left')).toBeVisible();
  await expect(page.locator('#session-scroll-right')).toBeDisabled();
  expect(await page.locator('#session-tab-list').evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe('none');
  const initialScroll = await page.locator('#session-tab-list').evaluate((el) => el.scrollLeft);
  await page.locator('#session-scroll-left').click();
  await expect.poll(() => page.locator('#session-tab-list').evaluate((el) => el.scrollLeft)).toBeLessThan(initialScroll - 1);
  await page.locator('.session-tab').first().click({ force: true });
  await expect(page.locator('#session-scroll-left')).toBeDisabled();
  await page.locator('#session-scroll-right').click();
  await expect.poll(() => page.locator('#session-tab-list').evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await page.locator('#session-tabs').dispatchEvent('wheel', { deltaY: 100 });
  await expect(page.locator('.session-tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  expect(await page.locator('.session-tab').nth(1).evaluate((el) => {
    const tab = el.getBoundingClientRect();
    const list = el.parentElement!.getBoundingClientRect();
    return tab.left >= list.left - 1 && tab.right <= list.right + 1;
  })).toBe(true);
  await page.setViewportSize({ width: 2400, height: 1000 });
  await expect(page.locator('#session-scroll-left')).toBeHidden();
  await expect(page.locator('#session-scroll-right')).toBeHidden();
  await expect(page.locator('#session-button-group')).toBeVisible();
  await expect(page.locator('#session-menu-toggle')).toBeHidden();
});
