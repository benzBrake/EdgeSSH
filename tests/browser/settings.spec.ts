import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_SETTINGS, type SettingsSnapshot } from '../../src/accounts/settings-data';
import { fileFixture, fileSession, connectFiles } from './file-fixture';

async function openSettings(page: Page) {
  if (!await page.locator('#session-settings').isVisible()) await page.locator('#session-menu-toggle').click();
  await page.locator('#session-settings').click();
  await expect(page.locator('#settings-page')).toBeVisible();
  for (const fieldset of await page.locator('#settings-page fieldset').all()) await expect(fieldset).toBeEnabled();
  return page.locator('#settings-page');
}

test('设置手动保存、恢复默认和取消修改，适配主题语言及手机', async ({ page }, testInfo) => {
  const { settingsState } = await fileFixture(page, { workbench: 'none' });
  const settings = await openSettings(page);
  const navBottom = (await page.locator('#session-tabs').boundingBox())!.y + (await page.locator('#session-tabs').boundingBox())!.height;
  expect((await page.locator('.home-rail').boundingBox())!.y).toBeGreaterThanOrEqual(navBottom);
  await expect(settings.getByLabel('终端字号')).toHaveValue('13');
  await settings.getByLabel('终端字号').fill('18');
  await settings.getByLabel('光标形状').selectOption('bar');
  await settings.getByLabel('光标闪烁').uncheck();
  await settings.getByLabel('SSH 命令编辑器默认展开').uncheck();
  await settings.getByLabel('编辑器收起时点击片段').selectOption('terminal');
  expect(settingsState.writes).toBe(0);
  await settings.getByRole('button', { name: '保存', exact: true }).click();
  await expect(settings.getByRole('status')).toHaveText('已保存');
  expect(settingsState.snapshot.settings).toEqual({ ...DEFAULT_SETTINGS, fontSize: 18, cursorStyle: 'bar', cursorBlink: false, sshEditorDefaultOpen: false, collapsedSnippetAction: 'terminal' });
  await settings.getByRole('button', { name: '恢复默认' }).click();
  await expect(settings.getByLabel('终端字号')).toHaveValue('13');
  expect(settingsState.writes).toBe(1);
  await settings.getByRole('button', { name: '取消修改' }).click();
  await expect(settings.getByLabel('终端字号')).toHaveValue('18');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('settings-dark.png'), fullPage: true });
  if (!await page.locator('#theme-toggle').isVisible()) await page.locator('#session-menu-toggle').click();
  await page.locator('#theme-toggle').click();
  await expect(settings.locator('[data-reload]')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: testInfo.outputPath('settings-light.png'), fullPage: true });
  if (!await page.locator('#session-language-toggle').isVisible()) await page.locator('#session-menu-toggle').click();
  await page.locator('#session-language-toggle').click();
  await page.locator('[data-language-choice="en"]').click();
  await expect(settings.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(settings.getByLabel('Terminal font size')).toHaveValue('18');
  await expect(settings.getByRole('group', { name: 'Session tab bar' })).toBeVisible();
  await expect(settings.getByLabel('Show settings button')).toBeChecked();
  await expect(settings.locator('[name="cursorStyle"] option:checked')).toHaveText('Bar');
  await page.reload();
  await openSettings(page);
  await expect(settings.getByLabel('Terminal font size')).toHaveValue('18');
});

test('标签栏按钮分别保存显示偏好，退出始终可用，隐藏设置后可从主页恢复', async ({ page }) => {
  const { settingsState } = await fileFixture(page, { workbench: 'none' });
  const settings = await openSettings(page);
  const buttons = [
    { name: '显示设置按钮', selector: '#session-settings' },
    { name: '显示主题切换按钮', selector: '#theme-toggle' },
    { name: '显示语言切换按钮', selector: '#session-language-toggle' },
    { name: '显示源代码仓库按钮', selector: '#session-button-group .home-github' },
  ];
  for (const [index, button] of buttons.entries()) {
    await settings.getByLabel(button.name, { exact: true }).uncheck();
    await expect(page.locator(button.selector)).toHaveJSProperty('hidden', false);
    await settings.getByRole('button', { name: '保存', exact: true }).click();
    await expect(settings.getByRole('status')).toHaveText('已保存');
    for (const [otherIndex, other] of buttons.entries()) {
      await expect(page.locator(other.selector)).toHaveJSProperty('hidden', otherIndex <= index);
    }
  }
  expect(settingsState.writes).toBe(4);
  await page.reload();
  await page.locator('#rail-settings').click();
  await expect(settings).toBeVisible();
  for (const button of buttons) {
    await expect(settings.getByLabel(button.name, { exact: true })).not.toBeChecked();
    await expect(page.locator(button.selector)).toHaveJSProperty('hidden', true);
  }
  if (page.viewportSize()!.width <= 600) {
    await page.locator('#session-menu-toggle').click();
    await expect(page.locator('#account-action')).toBeFocused();
  }
  await expect(page.locator('#account-action')).toBeVisible();
  await expect(page.locator('#account-logout-icon')).toBeVisible();
  for (const button of buttons) await expect(page.locator(button.selector)).toBeHidden();
  await settings.getByRole('button', { name: '恢复默认' }).click();
  for (const button of buttons) {
    await expect(settings.getByLabel(button.name, { exact: true })).toBeChecked();
    await expect(page.locator(button.selector)).toHaveJSProperty('hidden', true);
  }
  await settings.getByRole('button', { name: '取消修改' }).click();
  for (const button of buttons) await expect(settings.getByLabel(button.name, { exact: true })).not.toBeChecked();
  await settings.getByRole('button', { name: '恢复默认' }).click();
  await settings.getByRole('button', { name: '保存', exact: true }).click();
  await expect(settings.getByRole('status')).toHaveText('已保存');
  if (page.viewportSize()!.width <= 600) await page.locator('#session-menu-toggle').click();
  for (const button of buttons) await expect(page.locator(button.selector)).toBeVisible();
  await expect(page.locator('#account-action')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('保存失败和版本冲突保留草稿，重新加载后可明确重试', async ({ page }) => {
  const { settingsState } = await fileFixture(page, { workbench: 'none' });
  const settings = await openSettings(page);
  await settings.getByLabel('终端字号').fill('17');
  settingsState.saveError = true;
  await settings.getByRole('button', { name: '保存', exact: true }).click();
  await expect(settings.getByRole('status')).toHaveText('保存失败，请重试。');
  await expect(settings.getByLabel('终端字号')).toHaveValue('17');
  expect(settingsState.snapshot.revision).toBe(0);
  settingsState.saveError = false;
  settingsState.snapshot = { settings: { ...DEFAULT_SETTINGS, fontSize: 20 }, revision: 1, updatedAt: Date.now() };
  await settings.getByRole('button', { name: '保存', exact: true }).click();
  await expect(settings.getByRole('status')).toContainText('其他设备更新');
  await expect(settings.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await settings.getByRole('button', { name: '重新加载' }).click();
  await expect(settings.getByLabel('终端字号')).toHaveValue('17');
  await settings.getByRole('button', { name: '保存', exact: true }).click();
  await expect(settings.getByRole('status')).toHaveText('已保存');
  expect(settingsState.snapshot.revision).toBe(2);
  expect(settingsState.snapshot.settings.fontSize).toBe(17);
});

test('设置加载失败可重试，新工作台不使用未确认的默认设置', async ({ page }) => {
  const { settingsState } = await fileFixture(page, { workbench: 'none', settingsError: true });
  const settings = page.locator('#settings-page');
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('status')).toHaveText('设置加载失败，请重试。');
  await expect(settings.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await page.locator('#session-new').click();
  await expect(page.locator('.session-tab')).toHaveCount(0);
  settingsState.readError = false;
  await settings.getByRole('button', { name: '重新加载' }).click();
  for (const fieldset of await settings.locator('fieldset').all()) await expect(fieldset).toBeEnabled();
  await page.locator('#session-new').click();
  await expect(fileSession(page).locator('#connection-panel')).toBeVisible();
  expect(settingsState.writes).toBe(0);
});

test('重新加载期间输入的修改不被返回结果覆盖，读取失败保留已同步设置', async ({ page }) => {
  const { settingsState } = await fileFixture(page, { workbench: 'none' });
  const settings = await openSettings(page);
  await expect(settings.getByRole('button', { name: '重新加载' })).toBeEnabled();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/settings', async route => {
    await gate;
    return route.fulfill({ json: { settings: { ...DEFAULT_SETTINGS, fontSize: 17 }, revision: 1, updatedAt: Date.now() } });
  });
  await settings.getByRole('button', { name: '重新加载' }).click();
  await expect(settings.getByRole('status')).toHaveText('正在同步设置…');
  await settings.getByLabel('终端字号').fill('21');
  release();
  await expect(settings.getByRole('button', { name: '重新加载' })).toBeEnabled();
  await expect(settings.getByLabel('终端字号')).toHaveValue('21');
  await expect(settings.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  await page.unroute('**/api/settings');
  settingsState.readError = true;
  await settings.getByRole('button', { name: '重新加载' }).click();
  await expect(settings.getByRole('status')).toHaveText('设置加载失败，请重试。');
  await expect(settings.getByLabel('终端字号')).toHaveValue('21');
});

test('离开未保存设置需确认，切回会话保留连接和草稿', async ({ page }) => {
  const { calls } = await fileFixture(page, { workbench: 'ssh', initialCommand: '' });
  await connectFiles(page);
  const session = fileSession(page);
  await expect(session.locator('#live-orb')).toHaveClass(/connected/);
  await session.locator('#command-editor-input').fill('echo draft');
  await expect(session.locator('#command-editor-input')).toHaveValue('echo draft');
  const settings = await openSettings(page);
  await settings.getByLabel('终端字号').fill('16');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('.session-tab').click();
  await expect(settings).toBeVisible();
  await expect(settings.getByLabel('终端字号')).toHaveValue('16');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.session-tab').click();
  await expect(session.locator('#command-editor-input')).toHaveValue('echo draft');
  await expect(session.locator('#live-orb')).toHaveClass(/connected/);
  expect(calls.filter(call => call.type === 'connect')).toHaveLength(1);
});

test('已打开终端同步字号与光标，新会话应用编辑器默认值且 iframe 不读设置接口', async ({ page }) => {
  const childSettingsReads: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/settings' && request.frame() !== page.mainFrame()) childSettingsReads.push(request.url());
  });
  const { settingsState, calls } = await fileFixture(page, { workbench: 'ssh', initialCommand: '' });
  await connectFiles(page);
  const first = page.frameLocator('.session-frame-host iframe').nth(0);
  // ready 会聚焦终端；等握手完成后再填写草稿，避免输入被焦点切换送入终端。
  await expect(first.locator('#live-orb')).toHaveClass(/connected/);
  await first.locator('#command-editor-input').fill('keep draft');
  await expect(first.locator('#command-editor-input')).toHaveValue('keep draft');
  await first.locator('#command-editor-close').click();
  await page.locator('#session-new').click();
  await expect(fileSession(page).locator('#connection-panel')).toBeVisible();
  await connectFiles(page);
  await expect(fileSession(page).locator('#live-orb')).toHaveClass(/connected/);
  expect(childSettingsReads).toEqual([]);
  const settings = await openSettings(page);
  await settings.getByLabel('终端字号').fill('19');
  await settings.getByLabel('光标形状').selectOption('underline');
  await settings.getByLabel('光标闪烁').uncheck();
  await settings.getByLabel('SSH 命令编辑器默认展开').uncheck();
  await settings.getByRole('button', { name: '保存', exact: true }).click();
  await expect(settings.getByRole('status')).toHaveText('已保存');
  await page.locator('.session-tab').nth(0).click();
  await expect(first.locator('.xterm-rows')).toHaveCSS('font-size', '19px');
  await first.locator('.xterm-helper-textarea').focus();
  await expect(first.locator('.xterm-cursor')).toHaveClass(/xterm-cursor-underline/);
  await expect(first.locator('.xterm-cursor')).not.toHaveClass(/xterm-cursor-blink/);
  await expect(first.locator('#command-editor')).toBeHidden();
  await expect(first.locator('#command-editor-input')).toHaveValue('keep draft');
  await page.locator('.session-tab').nth(1).click();
  const second = page.frameLocator('.session-frame-host iframe').nth(1);
  await expect(second.locator('.xterm-rows')).toHaveCSS('font-size', '19px');
  await expect(second.locator('#command-editor')).toBeVisible();
  await page.locator('#session-new').click();
  await expect(fileSession(page).locator('#connection-panel')).toBeVisible();
  await connectFiles(page);
  await expect(fileSession(page).locator('#live-orb')).toHaveClass(/connected/);
  await expect(fileSession(page).locator('#command-editor')).toBeHidden();
  expect(calls.filter(call => call.type === 'resize').length).toBeGreaterThan(0);
});

test('收起时单行片段输入终端，无回车或修饰键；多行和已展开时进入编辑器', async ({ page }) => {
  const { calls } = await fileFixture(page, { workbench: 'ssh', initialCommand: '', settings: { ...DEFAULT_SETTINGS, sshEditorDefaultOpen: false, collapsedSnippetAction: 'terminal' } });
  const snippets = [ { id: 'single', name: '单行', command: 'pwd', updatedAt: 1 }, { id: 'multi', name: '多行', command: 'echo a\necho b', updatedAt: 1 } ];
  await page.route('**/api/snippets', route => route.fulfill({ json: { snippets } }));
  await connectFiles(page);
  const session = fileSession(page);
  await expect(session.locator('#live-orb')).toHaveClass(/connected/);
  const panel = session.locator('#snippet-panel');
  if (await panel.isVisible()) await panel.getByRole('button', { name: '收起代码片段' }).click();
  const menu = session.locator('#snippet-quick-menu');
  await session.locator('[data-terminal-modifier="ctrl"]').click();
  await session.locator('[data-terminal-modifier="alt"]').click();
  await session.locator('#snippet-menu-toggle').click();
  await menu.getByRole('button', { name: '插入终端 单行', exact: true }).click();
  expect(calls.filter(call => call.type === 'input').map(call => call.data)).toEqual(['pwd']);
  await expect(session.locator('#command-editor')).toBeHidden();
  await session.locator('#snippet-menu-toggle').click();
  await menu.getByRole('button', { name: '插入编辑器 多行', exact: true }).click();
  await expect(session.locator('#command-editor-input')).toHaveValue('echo a\necho b');
  expect(calls.filter(call => call.type === 'input')).toHaveLength(1);
  await session.locator('#snippet-menu-toggle').click();
  page.once('dialog', dialog => dialog.dismiss());
  await menu.getByRole('button', { name: '插入编辑器 单行', exact: true }).click();
  await expect(session.locator('#command-editor-input')).toHaveValue('echo a\necho b');
  page.once('dialog', dialog => dialog.accept());
  await menu.getByRole('button', { name: '插入编辑器 单行', exact: true }).click();
  await expect(session.locator('#command-editor-input')).toHaveValue('pwd');
  expect(calls.filter(call => call.type === 'input')).toHaveLength(1);
  await session.locator('body').evaluate(() => (window as any).wssh.disconnect());
  await session.locator('#command-editor-close').click();
  await session.locator('#snippet-menu-toggle').click();
  await menu.getByRole('button', { name: '插入终端 单行', exact: true }).click();
  await expect(session.locator('.toast').filter({ hasText: '终端未连接' })).toBeVisible();
  expect(calls.filter(call => call.type === 'input')).toHaveLength(1);
});

test('不同浏览器上下文切回同步，远端更新不覆盖未保存草稿', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext({ locale: 'zh-CN' }), browser.newContext({ locale: 'zh-CN' })]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  let snapshot: SettingsSnapshot = { settings: { ...DEFAULT_SETTINGS }, revision: 0, updatedAt: 0 };
  try {
    for (const page of pages) {
      await fileFixture(page, { workbench: 'none' });
      await page.route('**/api/settings', async route => {
        if (route.request().method() === 'PUT') {
          const body = route.request().postDataJSON();
          if (body.revision !== snapshot.revision) return route.fulfill({ status: 409, json: { error: '设置已在其他设备更新。' } });
          snapshot = { settings: body.settings, revision: snapshot.revision + 1, updatedAt: Date.now() };
        }
        return route.fulfill({ json: snapshot });
      });
      await openSettings(page);
    }
    const a = pages[0].locator('#settings-page'); const b = pages[1].locator('#settings-page');
    await a.getByLabel('终端字号').fill('18');
    await a.getByRole('button', { name: '保存', exact: true }).click();
    await expect(a.getByRole('status')).toHaveText('已保存');
    await pages[1].evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(b.getByLabel('终端字号')).toHaveValue('18');
    await b.getByLabel('终端字号').fill('21');
    await a.getByLabel('终端字号').fill('19');
    await a.getByRole('button', { name: '保存', exact: true }).click();
    await expect(a.getByRole('status')).toHaveText('已保存');
    await pages[1].evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(b.getByRole('status')).toContainText('其他设备已更新');
    await expect(b.getByLabel('终端字号')).toHaveValue('21');
    await expect(b.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    await b.getByRole('button', { name: '重新加载' }).click();
    await b.getByRole('button', { name: '保存', exact: true }).click();
    await expect(b.getByRole('status')).toHaveText('已保存');
    expect(snapshot.settings.fontSize).toBe(21);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('演示设置只在内存中保存，刷新恢复默认', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/settings')) requests.push(request.url()); });
  await page.goto('/?demo=1');
  const settings = await openSettings(page);
  await expect(settings.locator('.settings-demo')).toContainText('不会同步到数据库');
  await settings.getByLabel('终端字号').fill('16');
  await settings.getByRole('button', { name: '保存', exact: true }).click();
  await expect(settings.getByRole('status')).toHaveText('已保存');
  await page.reload();
  await openSettings(page);
  await expect(settings.getByLabel('终端字号')).toHaveValue('13');
  expect(requests).toEqual([]);
});
