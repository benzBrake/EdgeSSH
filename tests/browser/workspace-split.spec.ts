import { test, expect } from '@playwright/test';
import { connectFiles, fileFixture } from './file-fixture';
import { DEFAULT_SETTINGS } from '../../src/accounts/settings-data';
import { normalizeTerminalSize } from '../../src/types';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('edgessh:snippet-panel:collapsed', 'true'));
});

for (const fontSize of [13, 24]) {
  test(`SSH 分隔条拖到最小后保持合法尺寸与连接（字号 ${fontSize}）`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const fixture = await fileFixture(page, { workbench: 'ssh', settings: { ...DEFAULT_SETTINGS, fontSize, sshEditorDefaultOpen: false } });
    const session = await connectFiles(page);
    await expect(session.locator('#live-orb')).toHaveClass(/connected/);
    const divider = session.getByRole('separator', { name: '调整终端高度' });
    await expect(divider).toBeHidden();
    await session.locator('#file-manager-tab').click();
    await expect(session.locator('#file-table-body')).toContainText('README.md');
    await divider.press('End');
    const resizes = () => fixture.calls.filter(call => call.type === 'resize');
    await expect.poll(() => resizes().at(-1)?.rows).toBeGreaterThan(5);
    const baseline = resizes().length;
    const box = (await divider.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (testInfo.project.name === 'desktop') {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y - 600, { steps: 10 });
      await page.mouse.up();
    } else {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 100 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    }
    await expect.poll(async () => Number(await divider.getAttribute('aria-valuenow')))
      .toBe(Number(await divider.getAttribute('aria-valuemin')));
    await expect.poll(() => resizes().length).toBeGreaterThan(baseline);
    await expect.poll(() => resizes().at(-1)?.rows).toBe(5);
    await expect(session.locator('#command-editor')).toBeHidden();
    await session.locator('#command-editor-toggle').click();
    await expect(session.locator('#command-editor')).toBeVisible();
    await divider.press('End');
    await expect(divider).toHaveAttribute('aria-valuenow', (await divider.getAttribute('aria-valuemax'))!);
    await divider.press('Home');
    await expect.poll(() => resizes().at(-1)?.rows).toBe(5);
    await session.locator('#file-manager-tab').click();
    await expect(divider).toBeHidden();
    await session.locator('#file-manager-tab').click();
    await expect(session.locator('#live-orb')).toHaveClass(/connected/);
    for (const frame of fixture.calls.filter(call => call.type === 'resize' || call.type === 'connect')) {
      expect(normalizeTerminalSize(frame.cols, frame.rows), `${frame.type}: ${frame.cols}×${frame.rows}`)
        .toEqual({ cols: frame.cols, rows: frame.rows });
    }
    expect(fixture.sshSockets).toHaveLength(1);
    expect(fixture.sftpSockets).toHaveLength(1);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`ssh-split-min-${fontSize}.png`) });
  });
}

test('SSH 分割比例在面板切换、收起和隐藏会话后保留', async ({ page }) => {
  const fixture = await fileFixture(page, { workbench: 'ssh' });
  const session = await connectFiles(page);
  await expect(session.locator('#live-orb')).toHaveClass(/connected/);
  await session.locator('#file-manager-tab').click();
  const divider = session.getByRole('separator', { name: '调整终端高度' });
  const initial = Number(await divider.getAttribute('aria-valuenow'));
  await divider.press('ArrowUp');
  await expect(divider).toHaveAttribute('aria-valuenow', String(initial - 20));
  await divider.press('ArrowDown');
  await expect(divider).toHaveAttribute('aria-valuenow', String(initial));
  await divider.press('ArrowUp');
  const height = (await divider.getAttribute('aria-valuenow'))!;
  for (const tab of ['#process-manager-tab', '#event-toggle', '#file-manager-tab']) {
    await session.locator(tab).click();
    await expect(divider).toHaveAttribute('aria-valuenow', height);
  }
  await session.locator('#file-manager-tab').click();
  await expect(divider).toBeHidden();
  await expect(session.locator('.workspace-dock')).toHaveCSS('height', '34px');
  await session.locator('#file-manager-tab').click();
  await expect(divider).toHaveAttribute('aria-valuenow', height);
  await page.waitForTimeout(300);
  const baseline = fixture.calls.filter(call => call.type === 'resize').length;
  await page.locator('#session-home').click();
  await page.waitForTimeout(300);
  await page.locator('.session-tab').click();
  await expect(divider).toHaveAttribute('aria-valuenow', height);
  await page.waitForTimeout(300);
  expect(fixture.calls.filter(call => call.type === 'resize')).toHaveLength(baseline);
  await page.locator('#session-new').click();
  const second = await connectFiles(page, 'beta');
  await expect(second.locator('#live-orb')).toHaveClass(/connected/);
  await second.locator('#file-manager-tab').click();
  await expect(second.getByRole('separator')).toHaveAttribute('aria-valuenow', String(initial));
  await page.locator('.session-tab').first().click();
  await expect(divider).toHaveAttribute('aria-valuenow', height);
});

test('SSH 分隔条适配窄屏及中英文，视口恢复后恢复偏好比例', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '同一浏览器检查各尺寸及语言组合');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await fileFixture(page, { workbench: 'ssh' });
  const session = await connectFiles(page);
  await session.locator('#file-manager-tab').click();
  const divider = session.getByRole('separator');
  for (const language of ['zh-CN', 'en']) {
    await page.evaluate(value => {
      const iframe = document.querySelector<HTMLIFrameElement>('.session-frame-host iframe')!;
      iframe.contentWindow!.postMessage({ source: 'edgessh-parent', type: 'language', language: value }, location.origin);
      iframe.contentWindow!.postMessage({ source: 'edgessh-parent', type: 'theme', theme: value === 'en' ? 'light' : 'dark' }, location.origin);
    }, language);
    await expect(divider).toHaveAttribute('aria-label', language === 'en' ? 'Resize terminal' : '调整终端高度');
    for (const viewport of [{ width: 320, height: 640 }, { width: 375, height: 812 }, { width: 667, height: 375 }, { width: 1024, height: 768 }, { width: 1440, height: 1000 }]) {
      await page.setViewportSize(viewport);
      await divider.press('End');
      await expect.poll(async () => session.locator('#terminal-card').evaluate(root => {
        const pane = root.querySelector('.terminal-pane')!.getBoundingClientRect();
        const divider = root.querySelector('.workspace-divider')!.getBoundingClientRect();
        const dock = root.querySelector('.workspace-dock')!.getBoundingClientRect();
        const files = root.querySelector('.file-manager')!.getBoundingClientRect();
        const toolbar = root.querySelector('.file-toolbar')!.getBoundingClientRect();
        const status = root.querySelector('.file-statusbar')!.getBoundingClientRect();
        const table = root.querySelector('.file-table-wrap')!.getBoundingClientRect();
        return document.documentElement.scrollWidth <= innerWidth && table.height >= 80
          && status.bottom <= files.bottom + 1 && toolbar.bottom <= status.top
          && pane.bottom <= divider.top && divider.bottom <= dock.top && dock.bottom <= root.getBoundingClientRect().bottom;
      })).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`ssh-split-${language}-${viewport.width}.png`) });
    }
  }
  await divider.press('Home');
  await divider.press('ArrowDown');
  const restored = (await divider.getAttribute('aria-valuenow'))!;
  await page.setViewportSize({ width: 667, height: 375 });
  await expect.poll(async () => Number(await divider.getAttribute('aria-valuenow'))).toBeLessThan(Number(restored));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(divider).toHaveAttribute('aria-valuenow', restored);
  expect(errors).toEqual([]);
});
