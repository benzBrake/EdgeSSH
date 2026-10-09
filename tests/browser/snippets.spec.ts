import { test, expect, type Page, type FrameLocator } from '@playwright/test';
import { DEFAULT_SNIPPETS, type Snippet } from '../../src/accounts/snippet-data';
import { fileFixture, fileSession } from './file-fixture';

async function fixture(page: Page) {
  const files = await fileFixture(page, { workbench: 'none', initialCommand: '' });
  let items: Snippet[] = DEFAULT_SNIPPETS.map((item) => ({ ...item, id: crypto.randomUUID(), updatedAt: Date.now() }));
  await page.route('**/api/snippets**', async (route) => {
    const request = route.request();
    const id = new URL(request.url()).pathname.split('/')[3];
    if (request.method() === 'GET') return route.fulfill({ json: { snippets: items } });
    if (request.method() === 'DELETE') {
      items = items.filter((item) => item.id !== id);
      return route.fulfill({ json: { ok: true } });
    }
    const snippet = { ...request.postDataJSON(), id: id ?? crypto.randomUUID(), updatedAt: Date.now() };
    items = [snippet, ...items.filter((item) => item.id !== id)];
    return route.fulfill({ json: { snippet } });
  });
  return files;
}

async function connectSession(page: Page, id = 'alpha') {
  if (!await page.locator('.session-frame-host iframe').count()) await page.locator('#session-new').click();
  const session = fileSession(page);
  await expect(session.locator('#connection-panel')).toHaveAttribute('aria-hidden', 'false');
  await session.locator(`#profile-list [data-profile-id="${id}"]`).click();
  await expect(session.locator('#connection-panel')).toHaveAttribute('aria-hidden', 'true');
  await expect(session.locator('#app')).toBeVisible();
}

async function expandPanel(session: FrameLocator) {
  if (await session.locator('#snippet-panel').isHidden()) {
    await session.locator('#snippet-menu-toggle').click();
    await session.getByRole('button', { name: '展开浮窗', exact: true }).click();
  }
}

test('主页片段库支持十条默认命令、搜索、新建、多行编辑、删除及刷新持久化', async ({ page }, testInfo) => {
  await fixture(page);
  await page.locator('#rail-snippets').click();
  const library = page.locator('#snippets-page');
  await expect(library.locator('.snippet-card')).toHaveCount(10);
  await expect(page.locator('#rail-snippets')).toHaveAttribute('aria-current', 'page');
  await library.getByRole('searchbox').fill('磁盘');
  await expect(library.locator('.snippet-card')).toHaveCount(1);
  await library.getByRole('searchbox').fill('');
  await library.getByRole('button', { name: '新建片段', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建代码片段' });
  await dialog.getByLabel('名称').fill('部署检查 <script>');
  await dialog.getByLabel('命令', { exact: true }).fill('echo first\npwd');
  await dialog.getByRole('button', { name: '保存片段' }).click();
  await expect(library.locator('.snippet-card')).toHaveCount(11);
  await library.getByRole('button', { name: '编辑 部署检查 <script>', exact: true }).click();
  await page.getByRole('dialog').getByLabel('命令', { exact: true }).fill('echo second\nls -lah');
  await page.getByRole('button', { name: '保存片段', exact: true }).click();
  await page.reload();
  await page.locator('#rail-snippets').click();
  await expect(library.locator('.snippet-card').filter({ hasText: '部署检查 <script>' }).locator('pre')).toHaveText('echo second\nls -lah');
  page.once('dialog', (dialog) => dialog.accept());
  await library.getByRole('button', { name: '删除 查看当前目录', exact: true }).click();
  await expect(library.locator('.snippet-card')).toHaveCount(10);
  await library.getByRole('button', { name: '刷新代码片段' }).click();
  await expect(library.getByRole('heading', { name: '查看当前目录', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('snippet-library.png'), fullPage: true });
});

test('终端浮窗折叠、拖动与键盘复位；填入草稿而不执行，编辑与管理页同步', async ({ page }, testInfo) => {
  const files = await fixture(page);
  await connectSession(page);
  const session = fileSession(page);
  const panel = session.locator('#snippet-panel');
  await expandPanel(session);
  await expect(panel.locator('.snippet-card')).toHaveCount(10);
  await panel.getByRole('button', { name: '使用 查看磁盘空间', exact: true }).click();
  await expect(session.locator('#command-editor-input')).toHaveValue('df -h');
  expect(files.calls.filter((call) => call.type === 'input')).toHaveLength(0);
  await session.locator('#command-editor-send').click();
  await expect.poll(() => files.calls.filter((call) => call.type === 'input').at(-1)?.data).toBe('df -h\r');
  await expandPanel(session);
  const handle = panel.getByRole('button', { name: '移动代码片段窗口' });
  const before = (await panel.boundingBox())!;
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  const after = (await panel.boundingBox())!;
  expect(after.x).toBeLessThan(before.x);
  await page.keyboard.press('Home');
  if (testInfo.project.name === 'desktop') {
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x - 100, box.y + 60, { steps: 8 });
    await page.mouse.up();
    expect((await panel.boundingBox())!.x).toBeLessThan(before.x);
  }
  await panel.getByRole('button', { name: '收起代码片段' }).click();
  await expect(panel).toBeHidden();
  await expandPanel(session);
  await panel.getByRole('button', { name: '编辑 查看磁盘空间', exact: true }).click();
  await session.getByRole('dialog').getByLabel('名称').fill('磁盘概况');
  await session.getByRole('button', { name: '保存片段', exact: true }).click();
  await panel.locator('.snippet-manage').evaluate((element) => (element as HTMLButtonElement).click());
  await expect(session.locator('#snippets-page').getByRole('heading', { name: '磁盘概况', exact: true })).toBeVisible();
  await session.getByRole('button', { name: '返回终端', exact: true }).click();
  expect(files.calls.filter((call) => call.type === 'connect')).toHaveLength(1);
  await expect(session.locator('#snippet-panel')).toBeVisible();
  expect(await session.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('snippet-terminal.png'), fullPage: true });
});

test('加载与保存错误可重试，不丢失草稿；空列表不补回默认命令', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/snippets', (route) => route.fulfill({ status: 500, json: { error: '片段服务暂时不可用' } }));
  await page.locator('#rail-snippets').click();
  const library = page.locator('#snippets-page');
  await expect(library.getByRole('status')).toContainText('片段服务暂时不可用');
  await page.unroute('**/api/snippets');
  await library.getByRole('button', { name: '刷新代码片段' }).click();
  await expect(library.locator('.snippet-card')).toHaveCount(10);
  await library.getByRole('button', { name: '新建片段', exact: true }).click();
  await page.getByRole('dialog').getByLabel('名称').fill('保留草稿');
  await page.getByRole('dialog').getByLabel('命令', { exact: true }).fill('echo safe');
  await page.route('**/api/snippets', (route) => route.fulfill({ status: 500, json: { error: '保存失败，请重试。' } }));
  await page.getByRole('button', { name: '保存片段', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('保存失败');
  await expect(page.getByRole('dialog').getByLabel('命令', { exact: true })).toHaveValue('echo safe');
  await page.unroute('**/api/snippets');
  await page.getByRole('button', { name: '保存片段', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.route('**/api/snippets', (route) => route.fulfill({ json: { snippets: [] } }));
  await library.getByRole('button', { name: '刷新代码片段' }).click();
  await expect(library.locator('.snippet-empty')).toContainText('把常用命令留在手边');
  await library.getByRole('button', { name: '刷新代码片段' }).click();
  await expect(library.locator('.snippet-card')).toHaveCount(0);
});

test('多行片段保留换行且不直接发送；取消覆盖保留旧草稿，登出清空片段', async ({ page }) => {
  const files = await fixture(page);
  await connectSession(page);
  const session = fileSession(page);
  const panel = session.locator('#snippet-panel');
  await expandPanel(session);
  await panel.locator('.snippet-manage').evaluate((element) => (element as HTMLButtonElement).click());
  await session.locator('#snippets-page').getByRole('button', { name: '新建片段', exact: true }).click();
  await session.getByRole('dialog').getByLabel('名称').fill('多行脚本');
  await session.getByRole('dialog').getByLabel('命令', { exact: true }).fill('echo a\n# 注释\necho b');
  await session.getByRole('button', { name: '保存片段', exact: true }).click();
  await session.getByRole('button', { name: '返回终端', exact: true }).click();
  await expandPanel(session);
  await panel.getByRole('button', { name: '使用 多行脚本', exact: true }).click();
  await expect(session.locator('#command-editor-input')).toHaveValue('echo a\n# 注释\necho b');
  await expandPanel(session);
  page.once('dialog', (dialog) => dialog.dismiss());
  await panel.getByRole('button', { name: '使用 查看当前目录', exact: true }).click();
  await expect(session.locator('#command-editor-input')).toHaveValue('echo a\n# 注释\necho b');
  expect(files.calls.filter((call) => call.type === 'input')).toHaveLength(0);
  await session.locator('body').evaluate(() => window.dispatchEvent(new Event('auth-required')));
  await expect(session.locator('#snippet-panel .snippet-card')).toHaveCount(0);
  await expect(session.locator('#snippets-page .snippet-card')).toHaveCount(0);
});

test('浮窗在调整尺寸后仍可触达，并适配浅色及减少动态效果', async ({ page }, testInfo) => {
  await fixture(page);
  await connectSession(page);
  const session = fileSession(page);
  const panel = session.locator('#snippet-panel');
  const initiallyCollapsed = testInfo.project.name === 'mobile';
  if (initiallyCollapsed) await expect(panel.locator('#snippet-panel-body')).toBeHidden();
  else await expect(panel.locator('#snippet-panel-body')).toBeVisible();
  await expandPanel(session);
  await panel.getByRole('button', { name: '移动代码片段窗口' }).focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown');
  await page.setViewportSize({ width: 667, height: 375 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await session.locator('body').evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  const stage = (await session.locator('#terminal-card').boundingBox())!;
  const box = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(stage.x);
  expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
  expect(box.y).toBeGreaterThanOrEqual(stage.y);
  expect(box.y + box.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
  await panel.getByRole('button', { name: '收起代码片段' }).click();
  await expect(panel.locator('#snippet-panel-body')).toBeHidden();
  await expect(panel).toBeHidden();
  await session.locator('#snippet-menu-toggle').click();
  const menu = (await session.locator('#snippet-quick-menu').boundingBox())!;
  expect(menu.x).toBeGreaterThanOrEqual(stage.x);
  expect(menu.x + menu.width).toBeLessThanOrEqual(stage.x + stage.width);
  expect(menu.y).toBeGreaterThanOrEqual(stage.y);
  expect(menu.y + menu.height).toBeLessThanOrEqual(stage.y + stage.height);
  await page.screenshot({ path: testInfo.outputPath('snippet-landscape-light.png'), fullPage: true });
  await session.locator('#snippet-quick-menu').getByRole('searchbox').fill('df -h');
  await session.locator('#snippet-quick-menu').getByRole('button', { name: '使用 查看磁盘空间', exact: true }).click();
  await expect(session.locator('#command-editor-input')).toHaveValue('df -h');
});

test('快捷菜单位于命令按钮左侧，支持搜索、键盘选择、关闭及取消覆盖', async ({ page }, testInfo) => {
  const files = await fixture(page);
  await connectSession(page);
  const session = fileSession(page);
  const panel = session.locator('#snippet-panel');
  if (await panel.isVisible()) await panel.getByRole('button', { name: '收起代码片段' }).click();
  await expect(panel).toBeHidden();
  const launcher = session.locator('#snippet-menu-toggle');
  const menu = session.locator('#snippet-quick-menu');
  const search = menu.getByRole('searchbox');
  const launcherBox = (await launcher.boundingBox())!;
  const commandBox = (await session.locator('#command-editor-toggle').boundingBox())!;
  expect(launcherBox.x + launcherBox.width).toBeLessThanOrEqual(commandBox.x);
  await launcher.click();
  await expect(search).toBeFocused();
  await expect(menu.locator('.snippet-quick-item')).toHaveCount(10);
  expect((await menu.locator('.snippet-quick-item pre').first().boundingBox())!.height).toBeGreaterThan(0);
  expect((await menu.boundingBox())!.y + (await menu.boundingBox())!.height).toBeLessThan(launcherBox.y);
  await search.fill('df -h');
  await expect(menu.locator('.snippet-quick-item')).toHaveCount(1);
  await search.press('Tab');
  await expect(menu.getByRole('button', { name: '使用 查看磁盘空间', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  const input = session.locator('#command-editor-input');
  await expect(input).toHaveValue('df -h');
  await expect(input).toBeFocused();
  expect(files.calls.filter((call) => call.type === 'input')).toHaveLength(0);
  await launcher.click();
  await search.fill('pwd');
  page.once('dialog', dialog => dialog.dismiss());
  await menu.getByRole('button', { name: '使用 查看当前目录', exact: true }).click();
  await expect(menu).toBeVisible();
  await expect(search).toHaveValue('pwd');
  await expect(input).toHaveValue('df -h');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(launcher).toBeFocused();
  await launcher.click();
  await launcher.click();
  await expect(menu).toBeHidden();
  await launcher.click();
  await input.click();
  await expect(menu).toBeHidden();
  await launcher.click();
  await search.fill('');
  expect((await menu.boundingBox())!.y + (await menu.boundingBox())!.height).toBeLessThan((await launcher.boundingBox())!.y);
  await page.screenshot({ path: testInfo.outputPath('snippet-quick-menu.png'), fullPage: true });
});

test('菜单随编辑器高度变化重新定位，全屏时保持在工作台内', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验证全屏');
  await fixture(page);
  await connectSession(page);
  const session = fileSession(page);
  await session.getByRole('button', { name: '收起代码片段' }).click();
  const launcher = session.locator('#snippet-menu-toggle');
  const menu = session.locator('#snippet-quick-menu');
  await launcher.click();
  const assertAbove = async () => {
    await expect.poll(async () => {
      const menuBox = (await menu.boundingBox())!;
      const anchor = (await launcher.boundingBox())!;
      return menuBox.y + menuBox.height < anchor.y;
    }).toBe(true);
  };
  await assertAbove();
  await session.locator('#command-editor-close').evaluate(element => (element as HTMLButtonElement).click());
  await assertAbove();
  await page.keyboard.press('Escape');
  await session.locator('#fullscreen-terminal').click();
  await expect.poll(() => session.locator('body').evaluate(() => document.fullscreenElement?.id)).toBe('terminal-card');
  await launcher.click();
  await assertAbove();
  const stage = (await session.locator('#terminal-card').boundingBox())!;
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(stage.x);
  expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width);
  expect(box.y).toBeGreaterThanOrEqual(stage.y);
  await session.locator('body').evaluate(() => document.exitFullscreen());
});

test('快捷菜单与管理页同步，保留多行命令且登出清空', async ({ page }) => {
  const files = await fixture(page);
  await connectSession(page);
  const session = fileSession(page);
  const panel = session.locator('#snippet-panel');
  if (await panel.isVisible()) await panel.getByRole('button', { name: '收起代码片段' }).click();
  await session.locator('#snippet-menu-toggle').click();
  const menu = session.locator('#snippet-quick-menu');
  await menu.getByRole('button', { name: '管理代码片段', exact: true }).click();
  await expect(menu).toBeHidden();
  await session.locator('#snippets-page').getByRole('button', { name: '新建片段', exact: true }).click();
  await session.getByRole('dialog').getByLabel('名称').fill('多行快捷片段 <script>');
  await session.getByRole('dialog').getByLabel('命令', { exact: true }).fill('echo a\n# 注释\necho b');
  await session.getByRole('button', { name: '保存片段', exact: true }).click();
  await session.getByRole('button', { name: '返回终端', exact: true }).click();
  await session.locator('#command-editor-close').click();
  await session.locator('#snippet-menu-toggle').click();
  await menu.getByRole('button', { name: '使用 多行快捷片段 <script>', exact: true }).click();
  await expect(session.locator('#command-editor')).toBeVisible();
  await expect(session.locator('#command-editor-input')).toHaveValue('echo a\n# 注释\necho b');
  expect(files.calls.filter(call => call.type === 'input')).toHaveLength(0);
  await session.locator('#snippet-menu-toggle').click();
  await session.locator('body').evaluate(() => window.dispatchEvent(new Event('auth-required')));
  await expect(menu).toBeHidden();
  await expect(menu.locator('.snippet-quick-item')).toHaveCount(0);
});

test('快捷菜单显示加载、错误重试、无搜索结果和空列表，并响应语言切换', async ({ page }, testInfo) => {
  await fixture(page);
  await page.route('**/api/snippets', route => route.fulfill({ status: 500, json: { error: '片段服务暂时不可用' } }));
  await connectSession(page);
  const session = fileSession(page);
  const panel = session.locator('#snippet-panel');
  if (await panel.isVisible()) await panel.getByRole('button', { name: '收起代码片段' }).click();
  await session.locator('#snippet-menu-toggle').click();
  const menu = session.locator('#snippet-quick-menu');
  await expect(menu.getByRole('status')).toContainText('片段服务暂时不可用');
  await page.unroute('**/api/snippets');
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/snippets', async route => {
    await pending;
    await route.fulfill({ json: { snippets: [] } });
  });
  await menu.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(menu.getByRole('status')).toContainText('正在加载');
  release();
  await expect(menu.getByRole('status')).toContainText('暂无代码片段');
  await page.unroute('**/api/snippets');
  await menu.getByRole('button', { name: '管理代码片段', exact: true }).click();
  await expect(session.locator('#snippets-page .snippet-card')).toHaveCount(10);
  await session.getByRole('button', { name: '返回终端', exact: true }).click();
  await session.locator('#snippet-menu-toggle').click();
  await menu.getByRole('searchbox').fill('no-match-123');
  await expect(menu.getByRole('status')).toHaveText('没有匹配的片段');
  await page.keyboard.press('Escape');
  if (testInfo.project.name === 'mobile') await page.locator('#session-menu-toggle').click();
  await page.locator('#session-language-toggle').click();
  await page.locator('#language-menu [data-language-choice="en"]').click();
  await expect(session.locator('#snippet-menu-toggle')).toHaveAttribute('aria-label', 'Choose a snippet');
  await session.locator('#snippet-menu-toggle').click();
  await expect(menu.getByRole('status')).toHaveText('No matching snippets');
  await expect(menu.getByRole('button', { name: 'Expand panel', exact: true })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Manage snippets', exact: true })).toBeVisible();
});

test('桌面偏好跨新会话和刷新恢复，已有会话及手机不受影响', async ({ page }, testInfo) => {
  await fixture(page);
  const key = 'edgessh:snippet-panel:collapsed';
  if (testInfo.project.name === 'mobile') {
    await page.evaluate(key => localStorage.setItem(key, 'false'), key);
    await connectSession(page);
    const session = fileSession(page);
    await expect(session.locator('#snippet-panel')).toBeHidden();
    await expandPanel(session);
    await session.getByRole('button', { name: '收起代码片段' }).click();
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('false');
    await session.locator('body').evaluate(() => location.reload());
    await expect(session.locator('#snippet-menu-toggle')).toBeVisible();
    return;
  }
  await connectSession(page);
  const first = page.frameLocator('.session-frame-host iframe').nth(0);
  await expect(first.locator('#snippet-panel')).toBeVisible();
  await page.locator('#session-new').click();
  await expect(page.locator('.session-tab')).toHaveCount(2);
  const second = page.frameLocator('.session-frame-host iframe').nth(1);
  await expect(second.locator('#snippet-panel')).toBeVisible();
  await connectSession(page, 'beta');
  await second.getByRole('button', { name: '收起代码片段' }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('true');
  expect(await first.locator('#snippet-panel').evaluate(element => (element as HTMLElement).hidden)).toBe(false);
  await page.locator('#session-new').click();
  await expect(page.locator('.session-tab')).toHaveCount(3);
  const third = page.frameLocator('.session-frame-host iframe').nth(2);
  await expect(third.locator('#snippet-menu-toggle')).toBeVisible();
  await connectSession(page, 'beta');
  await third.locator('#snippet-menu-toggle').click();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('true');
  await third.locator('body').evaluate(() => location.reload());
  await expect(third.locator('#connection-panel')).toHaveAttribute('aria-hidden', 'false');
  await connectSession(page, 'beta');
  await expect(third.locator('#snippet-menu-toggle')).toBeVisible();
  await expandPanel(third);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('false');
  await third.locator('body').evaluate(() => location.reload());
  await expect(third.locator('#connection-panel')).toHaveAttribute('aria-hidden', 'false');
  await connectSession(page, 'beta');
  await expect(third.locator('#snippet-panel')).toBeVisible();
  await page.locator('#session-home').click();
  await page.locator('#rail-files').click();
  await expect(page.locator('.session-tab')).toHaveCount(4);
  const sftp = fileSession(page);
  await connectSession(page);
  expect(await sftp.locator('#snippet-panel').evaluate(element => (element as HTMLElement).hidden)).toBe(true);
  await sftp.locator('#sftp-terminal-collapse').click();
  await expandPanel(sftp);
  await sftp.getByRole('button', { name: '收起代码片段' }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('false');
});

test('代码片段偏好存储失败会提示但不阻止切换', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '仅桌面保存显示偏好');
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) {
      if (key === 'edgessh:snippet-panel:collapsed') throw new Error('Storage unavailable');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function(key, value) {
      if (key === 'edgessh:snippet-panel:collapsed') throw new Error('Storage unavailable');
      set.call(this, key, value);
    };
  });
  await fixture(page);
  await connectSession(page);
  const session = fileSession(page);
  await expect(session.locator('.toast').filter({ hasText: '无法读取代码片段显示偏好' })).toBeVisible();
  await session.getByRole('button', { name: '收起代码片段' }).click();
  await expect(session.locator('#snippet-panel')).toBeHidden();
  await expect(session.locator('.toast').filter({ hasText: '无法保存代码片段显示偏好' })).toBeVisible();
  await expandPanel(session);
  await expect(session.locator('#snippet-panel')).toBeVisible();
});
