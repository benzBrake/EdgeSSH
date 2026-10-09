import { test, expect } from '@playwright/test';
import { connectFiles, fileFixture, fileSession } from './file-fixture';

test('命令编辑器开关偏好跨新会话和刷新恢复，已有会话不受影响', async ({ page }) => {
  await fileFixture(page, { workbench: 'ssh', initialCommand: '' });
  await connectFiles(page);
  const key = 'edgessh:command-editor:collapsed';
  const first = page.frameLocator('.session-frame-host iframe').nth(0);
  await expect(first.locator('#command-editor')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();

  await page.locator('#session-new').click();
  await expect(page.locator('.session-tab')).toHaveCount(2);
  await expect(fileSession(page).locator('#connection-panel')).toHaveAttribute('aria-hidden', 'false');
  await connectFiles(page, 'beta');
  const second = fileSession(page);
  await second.locator('#command-editor-close').click();
  await expect(second.locator('#command-editor-toggle')).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('true');
  expect(await first.locator('#command-editor').evaluate(element => (element as HTMLElement).hidden)).toBe(false);

  await page.locator('#session-new').click();
  await expect(page.locator('.session-tab')).toHaveCount(3);
  await expect(fileSession(page).locator('#connection-panel')).toHaveAttribute('aria-hidden', 'false');
  await connectFiles(page);
  const third = fileSession(page);
  await expect(third.locator('#command-editor')).toBeHidden();
  await expect(third.locator('#command-editor-toggle')).toHaveAttribute('aria-label', '展开命令编辑器');
  await third.locator('body').evaluate(() => location.reload());
  await expect(third.locator('#connection-panel')).toHaveAttribute('aria-hidden', 'false');
  await connectFiles(page);
  await expect(third.locator('#command-editor')).toBeHidden();

  await third.locator('#command-editor-toggle').click();
  await expect(third.locator('#command-editor')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('false');
  await third.locator('body').evaluate(() => location.reload());
  await expect(third.locator('#connection-panel')).toHaveAttribute('aria-hidden', 'false');
  await connectFiles(page);
  await expect(third.locator('#command-editor')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('false');
});

test('SFTP 默认收起命令编辑器且初始化不覆盖用户偏好', async ({ page }) => {
  await fileFixture(page);
  const session = await connectFiles(page);
  const key = 'edgessh:command-editor:collapsed';
  await expect(session.locator('#sftp-connection-state')).toHaveText('SFTP 已连接');
  await session.locator('#sftp-terminal-collapse').click();
  await expect(session.locator('#command-editor')).toBeHidden();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();

  await session.locator('#command-editor-toggle').click();
  await expect(session.locator('#command-editor')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('false');
  await session.locator('body').evaluate(() => location.reload());
  await expect(session.locator('#connection-panel')).toHaveAttribute('aria-hidden', 'false');
  await connectFiles(page);
  await expect(session.locator('#sftp-connection-state')).toHaveText('SFTP 已连接');
  await session.locator('#sftp-terminal-collapse').click();
  await expect(session.locator('#command-editor')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('false');

  await session.locator('#command-editor-close').click();
  await page.locator('#session-new').click();
  await expect(fileSession(page).locator('#connection-panel')).toHaveAttribute('aria-hidden', 'false');
  await connectFiles(page);
  await expect(fileSession(page).locator('#command-editor')).toBeHidden();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('true');
});

test('命令编辑器偏好存储失败会提示但不阻止切换', async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) {
      if (key === 'edgessh:command-editor:collapsed') throw new Error('Storage unavailable');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function(key, value) {
      if (key === 'edgessh:command-editor:collapsed') throw new Error('Storage unavailable');
      set.call(this, key, value);
    };
  });
  await fileFixture(page, { workbench: 'ssh' });
  await connectFiles(page);
  const session = fileSession(page);
  await expect(session.locator('.toast').filter({ hasText: '无法读取命令编辑器显示偏好' })).toBeVisible();
  await session.locator('#command-editor-close').click();
  await expect(session.locator('#command-editor')).toBeHidden();
  await expect(session.locator('.toast').filter({ hasText: '无法保存命令编辑器显示偏好' })).toBeVisible();
  await session.locator('#command-editor-toggle').click();
  await expect(session.locator('#command-editor')).toBeVisible();
});

test('快捷工具栏与命令编辑器通过同一终端输入通道发送', async ({ page }, testInfo) => {
  const fixture = await fileFixture(page, { workbench: 'ssh', initialCommand: '' });
  await connectFiles(page);
  const session = fileSession(page);
  await expect(session.locator('#terminal-tools')).toBeVisible();

  const inputCalls = () => fixture.calls.filter((call) => call.type === 'input');
  const nativeInputStart = inputCalls().length;
  await session.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('pwd');
  await expect.poll(() => inputCalls().slice(nativeInputStart).map((call) => call.data).join('')).toBe('pwd');

  const shortcutInputStart = inputCalls().length;
  await session.locator('[data-terminal-key="esc"]').click();
  await session.locator('[data-terminal-modifier="ctrl"]').click();
  await session.locator('[data-terminal-key="left"]').click();
  await session.locator('[data-terminal-key="ctrl-c"]').click();
  expect(inputCalls().slice(shortcutInputStart).map((call) => call.data)).toEqual(['\x1b', '\x1b[1;5D', '\x03']);

  const editor = session.locator('#command-editor-input');
  await editor.fill('cd /opt/edgechat\nnpm ci\nnpm run build');
  await session.locator('#command-editor-send').click();
  expect(inputCalls().at(-1)?.data).toBe('cd /opt/edgechat\rnpm ci\rnpm run build\r');

  await editor.fill('echo first\necho second');
  await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(15, 15));
  await session.locator('#command-editor-send-menu').click();
  await session.locator('[data-command-send="line"]').click();
  expect(inputCalls().at(-1)?.data).toBe('echo second\r');

  await session.locator('#command-editor-insert').click();
  expect(inputCalls().at(-1)?.data).toBe('echo first; echo second');

  await session.locator('#command-editor-close').click();
  await expect(session.locator('#command-editor')).toBeHidden();
  await session.locator('#command-editor-toggle').click();
  await expect(session.locator('#command-editor')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('terminal-tools-connected.png'), fullPage: true });
});

test('移动端工具栏横向滚动且页面不产生横向溢出', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', '只核验移动端横向滚动布局');
  await fileFixture(page, { workbench: 'ssh' });
  await connectFiles(page);
  const session = fileSession(page);
  await expect(session.locator('#terminal-tools')).toBeVisible();
  const scrollState = await session.locator('.terminal-key-scroll').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(scrollState.scrollWidth).toBeGreaterThan(scrollState.clientWidth);
  expect(await session.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('terminal-tools-mobile.png'), fullPage: true });
});
