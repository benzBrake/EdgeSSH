import { test, expect } from '@playwright/test';
import { connectFiles, fileFixture, fileSession } from './file-fixture';

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
