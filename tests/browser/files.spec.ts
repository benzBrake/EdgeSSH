import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { connectFiles, fileFixture, fileSession } from './file-fixture';

test('文件管理新建 SFTP 标签，空主机与手机布局', async ({ page }, testInfo) => {
  await fileFixture(page, { noHosts: true });
  const session = fileSession(page);
  await expect(page.locator('.session-tab')).toHaveAttribute('data-session-kind', 'sftp');
  await expect(session.getByRole('heading', { name: 'SFTP 工作台' })).toBeVisible();
  await expect(session.locator('#profile-list')).toContainText('暂无');
  await expect(session.locator('#file-upload')).toBeDisabled();
  await expect(session.locator('#fullscreen-files')).toBeDisabled();
  await expect(session.locator('#terminal-stage')).toBeHidden();
  await expect(session.locator('.terminal-toolbar')).toBeVisible();
  await expect(session.locator('.sftp-terminal-title')).toHaveText('SSH 终端');
  await expect(session.locator('#sftp-terminal-collapse')).toHaveAttribute('aria-expanded', 'false');
  await expect(session.locator('.sftp-heading')).toHaveCount(0);
  await expect(session.locator('#files-notice')).toHaveCount(0);
  await expect(session.locator('#initial-command')).toBeHidden();
  expect(await session.locator('html').evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('sftp-empty.png') });
  await session.locator('#panel-close').click();
  await expect(page.locator('.session-tab')).toHaveCount(0);
  await expect(page.locator('#hosts-heading')).toBeVisible();
});

test('目录与选择在终端和标签切换后保留，连接不重复', async ({ page }, testInfo) => {
  const fixture = await fileFixture(page);
  const session = await connectFiles(page);
  await expect(session.locator('#sftp-connection-state')).toHaveText('SFTP 已连接');
  fixture.sshSockets[0].send(Buffer.from('retained-terminal-output\r\n'));
  await expect(session.locator('#file-manager-path')).toHaveValue('/root');
  const list = session.locator('.files-list');
  await list.getByRole('treeitem', { name: 'backups', exact: true }).dblclick();
  await expect(session.locator('#file-manager-path')).toHaveValue('/root/backups');
  await session.locator('#file-up').click();
  await list.getByRole('treeitem', { name: 'README.md', exact: true }).click();
  await session.locator('#sftp-terminal-collapse').click();
  await expect(session.locator('#sftp-terminal-pane')).toBeVisible();
  await expect(session.locator('#sftp-terminal-collapse')).toHaveAttribute('aria-expanded', 'true');
  await expect(session.locator('.xterm-rows')).toContainText('retained-terminal-output');
  const divider = session.getByRole('separator', { name: '调整终端高度' });
  const before = Number(await divider.getAttribute('aria-valuenow'));
  await divider.focus();
  await divider.press('ArrowUp');
  expect(Number(await divider.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
  await session.locator('#command-editor-toggle').click();
  await session.locator('#command-editor-input').fill('pwd');
  await session.locator('#sftp-terminal-collapse').click();
  await expect(session.locator('#sftp-terminal-collapse')).toBeFocused();
  await expect(session.locator('#terminal-tools')).toBeHidden();
  await expect(session.locator('#clear-terminal')).toBeHidden();
  await expect(session.locator('#fullscreen-terminal')).toBeHidden();
  await page.locator('#session-home').click();
  await expect(page.locator('#hosts-heading')).toBeVisible();
  await page.locator('.session-tab').click();
  await expect(session.locator('#terminal-stage')).toBeHidden();
  await expect(list.getByRole('treeitem', { name: 'README.md', exact: true })).toHaveAttribute('aria-selected', 'true');
  await session.locator('#sftp-terminal-collapse').click();
  await expect(session.locator('#command-editor-input')).toHaveValue('pwd');
  await expect(session.locator('.xterm-rows')).toContainText('retained-terminal-output');
  await session.locator('#command-editor-close').click();
  expect(fixture.sshSockets).toHaveLength(1);
  expect(fixture.sftpSockets).toHaveLength(1);
  expect(fixture.calls.filter(call => call.type === 'input' || call.type === 'terminal-input')).toHaveLength(0);
  expect(await session.locator('html').evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('sftp-terminal.png') });
  if (testInfo.project.name === 'mobile') await expect(session.locator('#file-tree')).toBeHidden();
});

test('文件全屏保留目录、选择和连接', async ({ page }, testInfo) => {
  const fixture = await fileFixture(page);
  const session = await connectFiles(page);
  await expect(session.locator('#file-manager-path')).toHaveValue('/root');
  await session.locator('.files-list').getByRole('treeitem', { name: 'README.md', exact: true }).click();
  await session.locator('#fullscreen-files').click();
  await expect.poll(() => session.locator('body').evaluate(() => document.fullscreenElement?.id)).toBe('file-manager-panel');
  await expect(session.locator('#exit-fullscreen-files')).toBeVisible();
  await expect(session.locator('#exit-fullscreen-files')).toBeFocused();
  await expect(session.locator('#file-download')).toBeEnabled();
  await expect(session.locator('#file-manager-path')).toHaveValue('/root');
  await page.screenshot({ path: testInfo.outputPath('sftp-fullscreen.png') });
  await session.locator('#exit-fullscreen-files').click();
  await expect(session.locator('#fullscreen-files')).toBeFocused();
  await expect(session.locator('.files-list').getByRole('treeitem', { name: 'README.md', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(fixture.sftpSockets).toHaveLength(1);
});

test('大目录虚拟化及首尾键盘导航', async ({ page }) => {
  const fixture = await fileFixture(page);
  const base = fixture.directories.get('/root')![2];
  fixture.directories.set('/root', Array.from({ length: 2000 }, (_, index) => ({ ...base, name: `server-${String(index).padStart(4, '0')}.log` })));
  const session = await connectFiles(page);
  const list = session.locator('.files-list');
  await expect(list.getByRole('treeitem', { name: 'server-0000.log', exact: true })).toBeVisible();
  expect(await list.getByRole('treeitem').count()).toBeLessThan(30);
  await expect(session.locator('#file-table-body tr')).toHaveCount(0);
  await list.getByRole('tree').focus();
  await list.getByRole('tree').press('End');
  await expect(list.getByRole('treeitem', { name: 'server-1999.log', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(session.locator('#file-download')).toBeEnabled();
  await list.getByRole('tree').press('ArrowUp');
  await expect(list.getByRole('treeitem', { name: 'server-1998.log', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.locator('#session-home').click();
  await page.locator('.session-tab').click();
  await expect(list.getByRole('treeitem', { name: 'server-1998.log', exact: true })).toBeVisible();
  await expect(list.getByRole('treeitem', { name: 'server-1998.log', exact: true })).toHaveAttribute('aria-selected', 'true');
  await list.getByRole('tree').press('Home');
  await expect(list.getByRole('treeitem', { name: 'server-0000.log', exact: true })).toBeVisible();
});

test('目录操作和上传下载协议与字节校验', async ({ page }) => {
  const fixture = await fileFixture(page);
  const session = await connectFiles(page);
  await expect(session.locator('#file-mkdir')).toBeEnabled();
  page.once('dialog', dialog => dialog.accept('test-folder'));
  await session.locator('#file-mkdir').click();
  await session.locator('.files-list').getByRole('treeitem', { name: 'test-folder', exact: true }).click();
  page.once('dialog', dialog => dialog.accept('renamed-folder'));
  await session.locator('#file-rename').click();
  const renamed = session.locator('.files-list').getByRole('treeitem', { name: 'renamed-folder', exact: true });
  await renamed.click();
  page.once('dialog', dialog => dialog.dismiss());
  await session.locator('#file-delete').click();
  await expect(renamed).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await session.locator('#file-delete').click();
  await expect(renamed).toHaveCount(0);
  const payload = Buffer.from('file manager upload regression\n');
  await session.locator('#file-upload-input').setInputFiles({ name: 'upload.txt', mimeType: 'text/plain', buffer: payload });
  await expect(session.locator('.files-list')).toContainText('upload.txt');
  expect(Buffer.concat(fixture.uploaded)).toEqual(payload);
  await session.locator('.files-list').getByRole('treeitem', { name: 'README.md', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await session.locator('#file-download').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('README.md');
  expect(await readFile((await download.path())!, 'utf8')).toBe('hello files\n');
  expect(fixture.calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'sftp_mkdir', path: '/root/test-folder' }),
    expect.objectContaining({ type: 'sftp_rename', oldPath: '/root/test-folder', newPath: '/root/renamed-folder' }),
    expect.objectContaining({ type: 'sftp_rmdir', path: '/root/renamed-folder' }),
  ]));
});

test('更换主机清理旧会话并更新标签', async ({ page }) => {
  const fixture = await fileFixture(page);
  const session = await connectFiles(page);
  await expect(session.locator('#file-upload')).toBeEnabled();
  await session.locator('#sftp-disconnect').click();
  await expect(session.locator('#file-upload')).toBeDisabled();
  await expect(session.locator('#sftp-connection-state')).toHaveText('SFTP 未连接');
  await page.locator('.session-tab-close').click();
  await expect(page.locator('.session-tab')).toHaveCount(0);
  await page.locator('#rail-files').click();
  await expect(page.locator('.session-tab')).toHaveCount(1);
  await connectFiles(page, 'beta');
  await expect(session.locator('#file-upload')).toBeEnabled();
  await expect(page.locator('.session-tab-label')).toHaveText('SFTP · Singapore backup');
  expect(fixture.calls.filter(call => call.type === 'connect').map(call => call.host)).toEqual(['192.0.2.10', '192.0.2.20']);
  expect(fixture.calls.filter(call => call.type === 'sftp_close')).toHaveLength(1);
});

test('指纹确认前不启用文件操作', async ({ page }) => {
  const fixture = await fileFixture(page, { firstSeen: true });
  const session = await connectFiles(page);
  await expect(session.locator('#host-key-dialog')).toBeVisible();
  await expect(session.locator('#file-upload')).toBeDisabled();
  expect(fixture.sftpSockets).toHaveLength(0);
  await session.locator('#accept-host-key').click();
  await expect(session.locator('#file-upload')).toBeEnabled();
});

for (const failure of ['credentials', 'authorization']) {
  test(`${failure} 失败显示根因并允许重试`, async ({ page }) => {
    await fileFixture(page, { credentialError: failure === 'credentials' });
    if (failure === 'authorization') await page.route('**/api/session', route => route.fulfill({ status: 403, json: { error: '会话授权失败，请重新登录。' } }));
    const session = await connectFiles(page);
    await expect(session.locator('.file-statusbar #sftp-connection-message')).toContainText(failure === 'credentials' ? '读取凭据失败' : '会话授权失败');
    await expect(session.locator('#sftp-connection-message')).toBeVisible();
    await expect(session.locator('#file-manager-status')).toBeHidden();
    await expect(session.locator('#sftp-connection-state')).toHaveText('连接失败');
    await expect(session.locator('#file-upload')).toBeDisabled();
    await expect(page.locator('.session-tab-status')).toHaveClass(/error/);
  });
}

test('目录权限错误可恢复且不改变文件通道状态', async ({ page }) => {
  await fileFixture(page);
  const session = await connectFiles(page);
  await expect(session.locator('#file-upload')).toBeEnabled();
  await session.locator('#file-manager-path').fill('/forbidden');
  await session.locator('#file-manager-path').press('Enter');
  await expect(session.locator('#file-manager-error')).toBeVisible();
  await expect(session.locator('#sftp-connection-state')).toHaveText('SFTP 已连接');
  await session.locator('#file-home').click();
  await expect(session.locator('.files-list')).toContainText('README.md');
  await expect(session.locator('#file-manager-error')).toBeHidden();
});

test('后台传输不中断；关闭及断开需要确认', async ({ page }) => {
  const fixture = await fileFixture(page, { holdUpload: true });
  const session = await connectFiles(page);
  await expect(session.locator('#file-upload')).toBeEnabled();
  await session.locator('#file-upload-input').setInputFiles({ name: 'pending.txt', mimeType: 'text/plain', buffer: Buffer.from('pending') });
  await expect(session.locator('#file-manager-progress')).toBeVisible();
  await session.locator('#sftp-terminal-collapse').click();
  await session.locator('#sftp-terminal-collapse').click();
  await page.locator('#session-home').click();
  await page.locator('#session-new').click();
  await page.locator('.session-tab[data-session-kind="sftp"]').click();
  await expect(session.locator('#file-manager-progress')).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('.session-tab[data-session-kind="sftp"] .session-tab-close').click();
  await expect(page.locator('.session-tab[data-session-kind="sftp"] .session-tab-close')).toBeEnabled();
  await expect(session.locator('#file-manager-progress')).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await session.locator('#sftp-disconnect').click();
  await expect(session.locator('#file-manager-progress')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.session-tab[data-session-kind="sftp"] .session-tab-close').click();
  await expect(page.locator('.session-tab[data-session-kind="sftp"]')).toHaveCount(0);
  expect(fixture.sftpSockets).toHaveLength(1);
  expect(fixture.calls.filter(call => call.type === 'sftp_close')).toHaveLength(1);
});

test('关闭读取凭据中的标签后，迟到结果不会启动会话', async ({ page }) => {
  const fixture = await fileFixture(page);
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/hosts/alpha/credentials', async route => { await pending; await route.fulfill({ json: { password: 'test-only' } }); });
  const session = await connectFiles(page);
  await expect(session.locator('#sftp-connection-state')).toHaveText('读取凭据中…');
  await expect(session.locator('.file-statusbar #sftp-connection-message')).toHaveText('正在读取主机凭据…');
  await expect(session.locator('#sftp-connection-message')).toBeVisible();
  await expect(session.locator('#sftp-terminal-collapse')).toBeDisabled();
  await page.locator('.session-tab-close').click();
  await expect(page.locator('.session-tab')).toHaveCount(0);
  finish();
  await page.locator('#rail-files').click();
  await expect(fileSession(page).getByRole('heading', { name: 'SFTP 工作台' })).toBeVisible();
  expect(fixture.sshSockets).toHaveLength(0);
});

test('确认主动断开后取消传输并可在新标签重连', async ({ page }) => {
  const fixture = await fileFixture(page, { holdUpload: true });
  const session = await connectFiles(page);
  await expect(session.locator('#file-upload')).toBeEnabled();
  await session.locator('#file-upload-input').setInputFiles({ name: 'pending.txt', mimeType: 'text/plain', buffer: Buffer.from('pending') });
  await expect(session.locator('#file-manager-progress')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await session.locator('#sftp-disconnect').click();
  await expect(session.locator('#sftp-connection-state')).toHaveText('SFTP 未连接');
  await expect(session.locator('#file-manager-progress')).toBeHidden();
  await expect(page.locator('.session-tab')).toHaveCount(1);
  expect(fixture.calls.filter(call => call.type === 'sftp_close')).toHaveLength(1);
  await page.locator('.session-tab-close').click();
  await expect(page.locator('.session-tab')).toHaveCount(0);
  await page.locator('#rail-files').click();
  await connectFiles(page, 'beta');
  await expect(session.locator('#sftp-connection-state')).toHaveText('SFTP 已连接');
  expect(fixture.sshSockets).toHaveLength(2);
});

test('SSH 就绪不冒充 SFTP 就绪，文件通道重连独立', async ({ page }) => {
  const fixture = await fileFixture(page, { holdSftp: true });
  const session = await connectFiles(page);
  await expect(session.locator('#sftp-connection-state')).toHaveText('正在连接 SFTP');
  await expect(session.locator('#file-tree [role="treeitem"]')).toHaveCount(0);
  await expect(session.locator('#file-upload')).toBeDisabled();
  fixture.sftpSockets[0].send(JSON.stringify({ type: 'sftp_ready', cwd: '/root', version: 3 }));
  await expect(session.locator('#sftp-connection-state')).toHaveText('SFTP 已连接');
  fixture.sftpSockets[0].close({ code: 1011, reason: 'Interrupted' });
  await expect(session.locator('#sftp-connection-state')).toHaveText('SFTP 正在重连');
  await expect(session.locator('#file-upload')).toBeDisabled();
  await expect.poll(() => fixture.sftpSockets.length).toBe(2);
  fixture.sftpSockets[1].send(JSON.stringify({ type: 'sftp_ready', cwd: '/root', version: 3 }));
  await expect(session.locator('#file-upload')).toBeEnabled();
  expect(fixture.sshSockets).toHaveLength(1);
});

test('文件通道初始化失败显示根因，终端仍可展开', async ({ page }) => {
  await fileFixture(page, { sftpError: true });
  const session = await connectFiles(page);
  await expect(session.locator('#sftp-connection-state')).toHaveText('SFTP 连接失败');
  await expect(session.locator('#file-manager-error')).toContainText('SFTP subsystem unavailable');
  await expect(session.locator('#file-upload')).toBeDisabled();
  await session.locator('#sftp-terminal-collapse').click();
  await expect(session.locator('#terminal-tools')).toBeVisible();
});

test('多个 SFTP 标签独立，SSH 文件 dock 保留', async ({ page }) => {
  const fixture = await fileFixture(page);
  await connectFiles(page);
  const first = page.frameLocator('.session-frame-host iframe').nth(0);
  await expect(first.locator('#file-manager-path')).toHaveValue('/root');
  await first.locator('#file-manager-path').fill('/root/backups');
  await first.locator('#file-manager-path').press('Enter');
  await expect(first.locator('#file-manager-path')).toHaveValue('/root/backups');
  await page.locator('#session-home').click();
  await page.locator('#rail-files').click();
  await connectFiles(page, 'beta');
  await expect(fileSession(page).locator('#file-manager-path')).toHaveValue('/root');
  await page.locator('.session-tab').nth(0).click();
  await expect(first.locator('#file-manager-path')).toHaveValue('/root/backups');
  await page.locator('#session-new').click();
  const ssh = fileSession(page);
  await expect(ssh.getByRole('heading', { name: 'SSH 工作台' })).toBeVisible();
  await connectFiles(page);
  await expect(ssh.locator('#live-orb')).toHaveClass(/connected/);
  await ssh.locator('#file-manager-tab').click();
  await expect(ssh.locator('#file-table-body')).toContainText('README.md');
  await expect(ssh.locator('.sftp-workbench')).toHaveCount(0);
  expect(fixture.sshSockets).toHaveLength(3);
  await expect.poll(() => fixture.calls.filter(call => call.type === 'input').map(call => call.data.trim())).toEqual(['echo should-not-run-in-files']);
});

test('临时 SFTP 连接复用表单、同步语言主题和终端分隔条', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await fileFixture(page, { noHosts: true });
  const session = fileSession(page);
  await session.locator('#temporary-tab').click();
  await session.locator('#host').fill('192.0.2.30');
  await session.locator('#username').fill('deploy');
  await session.locator('#password').fill('test-only');
  await session.locator('#connect-button').click();
  await expect(session.locator('#sftp-connection-state')).toHaveText('SFTP 已连接');
  await expect(page.locator('.session-tab-label')).toContainText('deploy@192.0.2.30');
  await expect(session.locator('#profile-id')).toHaveValue('');
  await session.locator('#sftp-terminal-collapse').click();
  const divider = session.getByRole('separator', { name: '调整终端高度' });
  const initial = Number(await divider.getAttribute('aria-valuenow'));
  if (testInfo.project.name === 'desktop') {
    const box = (await divider.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y - 36);
    await page.mouse.up();
    expect(Number(await divider.getAttribute('aria-valuenow'))).toBeGreaterThan(initial);
  }
  if (testInfo.project.name === 'mobile') await page.locator('#session-menu-toggle').click();
  await page.locator('#theme-toggle').click();
  await expect(session.locator('html')).toHaveAttribute('data-theme', 'light');
  if (testInfo.project.name === 'mobile') await page.locator('#session-menu-toggle').click();
  await page.locator('#session-language-toggle').click();
  await page.locator('[data-language-choice="en"]').click();
  await expect(session.locator('#sftp-connection-state')).toHaveText('SFTP connected');
  await expect(session.locator('#sftp-terminal-collapse')).toHaveAttribute('aria-label', 'Hide terminal');
  await page.screenshot({ path: testInfo.outputPath('sftp-light-en.png') });
  await session.locator('#sftp-terminal-collapse').click();
  await expect(session.locator('#sftp-terminal-collapse')).toHaveAttribute('aria-label', 'Show terminal');
  await expect(session.locator('.sftp-terminal-title')).toHaveText('SSH terminal');
  expect(await session.locator('.terminal-toolbar').evaluate(toolbar => {
    const status = document.querySelector('.file-statusbar')!;
    return getComputedStyle(toolbar).backgroundColor === getComputedStyle(status).backgroundColor;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('sftp-collapsed-light-en.png') });
  await session.locator('#sftp-terminal-collapse').click();
  await page.setViewportSize({ width: 667, height: 375 });
  expect(await session.locator('html').evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
  const pane = (await session.locator('#sftp-terminal-pane').boundingBox())!;
  const files = (await session.locator('#file-manager-panel').boundingBox())!;
  expect(files.height).toBeGreaterThan(0);
  expect(files.y + files.height).toBeLessThanOrEqual(pane.y);
  expect(fixture.sshSockets).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('320px 到桌面中英文布局保持文件状态栏可见', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '同一浏览器检查各尺寸及语言组合');
  await fileFixture(page);
  const session = await connectFiles(page);
  await expect(session.locator('#sftp-connection-state')).toHaveText('SFTP 已连接');
  for (const language of ['zh-CN', 'en']) {
    await page.evaluate(value => {
      const iframe = document.querySelector<HTMLIFrameElement>('.session-frame-host iframe')!;
      iframe.contentWindow!.postMessage({ source: 'edgessh-parent', type: 'language', language: value }, location.origin);
      iframe.contentWindow!.postMessage({ source: 'edgessh-parent', type: 'theme', theme: value === 'en' ? 'light' : 'dark' }, location.origin);
    }, language);
    await expect(session.locator('#sftp-terminal-collapse')).toHaveAttribute('aria-label', language === 'en' ? /terminal$/ : /终端$/);
    for (const viewport of [{ width: 320, height: 640 }, { width: 375, height: 812 }, { width: 667, height: 375 }, { width: 1024, height: 768 }, { width: 1440, height: 1000 }]) {
      await page.setViewportSize(viewport);
      for (const open of [false, true]) {
        if (await session.locator('#sftp-terminal-collapse').getAttribute('aria-expanded') !== String(open)) await session.locator('#sftp-terminal-collapse').click();
        await expect.poll(async () => session.locator('#terminal-card').evaluate(root => {
          const files = root.querySelector('.file-manager')!.getBoundingClientRect();
          const toolbar = root.querySelector('.file-toolbar')!.getBoundingClientRect();
          const status = root.querySelector('.file-statusbar')!.getBoundingClientRect();
          const table = root.querySelector('.file-table-wrap')!.getBoundingClientRect();
          const terminal = root.querySelector<HTMLElement>('.terminal-pane')!;
          return document.documentElement.scrollWidth <= innerWidth && table.height >= 80 && status.bottom <= files.bottom + 1
            && toolbar.bottom <= status.top && (files.bottom <= terminal.getBoundingClientRect().top)
            && (innerWidth > 760 || getComputedStyle(root.querySelector('.file-tree')!).display === 'none');
        })).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`sftp-${language}-${viewport.width}-${open ? 'terminal' : 'files'}.png`) });
      }
    }
  }
});
