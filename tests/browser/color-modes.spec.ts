import { test, expect, type Locator, type Page } from '@playwright/test';
import { connectFiles, fileFixture, fileSession } from './file-fixture';

async function toggleTheme(page: Page) {
  if (!await page.locator('#theme-toggle').isVisible()) await page.locator('#session-menu-toggle').click();
  await page.locator('#theme-toggle').click();
  if (await page.locator('#session-button-group').getAttribute('data-open') !== null) {
    await page.locator('#session-menu-toggle').click();
  }
}

async function contrast(locator: Locator, foreground = 'color', background = 'background-color') {
  return locator.evaluate((element, { foreground, background }) => {
    const style = getComputedStyle(element);
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    let backgroundColor = style.getPropertyValue(background);
    if (background === 'background-color') {
      for (let parent = element.parentElement; parent && backgroundColor === 'rgba(0, 0, 0, 0)'; parent = parent.parentElement) {
        backgroundColor = getComputedStyle(parent).backgroundColor;
      }
    }
    const a = luminance(style.getPropertyValue(foreground));
    const b = luminance(backgroundColor);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, { foreground, background });
}

test('首页公共页面与弹窗共用配色，主要文字和控件轮廓保持对比度', async ({ page }, testInfo) => {
  await fileFixture(page, { workbench: 'none' });
  await page.route('**/api/forward-rules', route => route.fulfill({ json: { rules: [] } }));
  for (const theme of ['dark', 'light']) {
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const surface = theme === 'dark' ? 'rgb(24, 35, 46)' : 'rgb(255, 255, 255)';
    for (const [nav, panel] of [['#rail-settings', '.settings-page fieldset'], ['#rail-snippets', '.snippet-page'], ['#rail-forward', '.forward-page']]) {
      await page.locator(nav).click();
      await expect(page.locator(panel).first()).toBeVisible();
      await expect(page.locator('#dashboard')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(16, 24, 32)' : 'rgb(250, 251, 253)');
      await expect(page.locator('.home-rail')).toHaveCSS('background-color', surface);
      await expect(page.locator('#dashboard')).toHaveCSS('color-scheme', theme);
      expect(await contrast(page.locator(nav))).toBeGreaterThanOrEqual(4.5);
    }
    await page.locator('#rail-settings').click();
    const primary = page.locator('.settings-page .home-button.primary');
    expect(await contrast(primary)).toBeGreaterThanOrEqual(4.5);
    const input = page.locator('.settings-page input[type="number"]').first();
    expect(await contrast(input, 'border-top-color')).toBeGreaterThanOrEqual(3);
    await page.locator('#rail-snippets').click();
    await page.locator('.snippet-page [data-new]').click();
    const dialog = page.locator('.snippet-page-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('background-color', surface);
    expect(await contrast(dialog.locator('.snippet-primary'))).toBeGreaterThanOrEqual(4.5);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.locator('#rail-overview').click();
    expect(await contrast(page.locator('.home-search'), 'border-top-color')).toBeGreaterThanOrEqual(3);
    expect(await contrast(page.locator('.connect-host').first())).toBeGreaterThanOrEqual(4.5);
    await page.locator('.host-row').first().hover();
    const row = page.locator('.host-row').first();
    await expect(row.locator('.host-copy > span')).toHaveCSS('color', await row.evaluate(element => getComputedStyle(element).color));
    expect(await contrast(row)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: testInfo.outputPath(`home-${theme}.png`) });
    if (theme === 'dark') await toggleTheme(page);
  }
});

test('终端外壳随模式更新，固定深色区域、输出、草稿和会话保持', async ({ page }, testInfo) => {
  const fixture = await fileFixture(page, { workbench: 'ssh', initialCommand: '' });
  await connectFiles(page);
  const session = fileSession(page);
  const input = session.locator('#command-editor-input');
  await expect(input).toBeVisible();
  await input.fill('echo keep draft');
  const output = 'theme-review-output';
  fixture.sshSockets[0].send(Buffer.from(output));
  await expect(session.locator('.xterm-rows')).toContainText(output);
  for (const theme of ['dark', 'light', 'dark']) {
    await expect(session.locator('html')).toHaveAttribute('data-theme', theme);
    const group = theme === 'light' ? 'rgb(244, 247, 247)' : 'rgb(22, 35, 46)';
    await expect(session.locator('.terminal-toolbar')).toHaveCSS('background-color', group);
    await expect(session.locator('.command-editor')).toHaveCSS('background-color', group);
    await expect(session.locator('.terminal-key').first()).toHaveCSS('background-color', theme === 'light' ? 'rgb(229, 237, 236)' : 'rgb(32, 51, 66)');
    expect(await contrast(session.locator('.terminal-actions .toolbar-button').first())).toBeGreaterThanOrEqual(4.5);
    await expect(input).toHaveCSS('background-color', 'rgb(16, 26, 36)');
    await expect(input).toHaveCSS('color-scheme', 'dark');
    await expect(session.locator('.terminal-stage')).toHaveCSS('color-scheme', 'dark');
    await input.focus();
    await expect(input).toHaveCSS('box-shadow', 'rgb(105, 230, 180) 0px 0px 0px 1px inset');
    expect(await contrast(input)).toBeGreaterThanOrEqual(4.5);
    expect(await contrast(session.locator('#command-editor-send'))).toBeGreaterThanOrEqual(4.5);
    await expect(input).toHaveValue('echo keep draft');
    await expect(session.locator('.xterm-rows')).toContainText(output);
    expect(fixture.sshSockets).toHaveLength(1);
    await page.screenshot({ path: testInfo.outputPath(`terminal-${theme}.png`) });
    await toggleTheme(page);
  }
  await page.locator('#session-new').click();
  await expect(fileSession(page).locator('html')).toHaveAttribute('data-theme', 'light');
  expect(fixture.sshSockets).toHaveLength(1);
});
