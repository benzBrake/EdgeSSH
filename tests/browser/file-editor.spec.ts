import { expect, test } from '@playwright/test';
import { connectFiles, fileFixture, fileSession } from './file-fixture';

for (const workbench of ['sftp', 'ssh'] as const) {
  test(`${workbench.toUpperCase()} 文件操作图标在窄屏不产生横向滚动`, async ({ page }) => {
    await fileFixture(page, { workbench });
    const session = await connectFiles(page);
    if (workbench === 'ssh') await session.locator('#file-manager-tab').click();
    for (const [id, label] of [['file-more', '文件菜单'], ['file-new', '新建文件']] as const) {
      const button = session.locator(`#${id}`);
      await expect(button).toHaveAttribute('aria-label', label);
      await expect(button).toHaveAttribute('title', label);
      await expect(button.locator('svg')).toHaveCount(1);
      await expect(button).toHaveText('');
    }
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 640 });
      expect(await session.locator('.file-actions').evaluate(actions =>
        actions.scrollWidth <= actions.clientWidth && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}

test('文本预览、CRLF/BOM 保存、新建文件和当前目录筛选', async ({ page }, testInfo) => {
  const fixture = await fileFixture(page);
  const original = Buffer.from('\ufeffline one\r\nline two\r\n');
  fixture.files.set('/root/README.md', original);
  fixture.directories.get('/root')![2].size = original.length;
  const session = await connectFiles(page);
  await session.locator('#file-filter').fill('readme');
  await expect(session.locator('.files-list').getByRole('treeitem')).toHaveCount(1);
  await expect(session.locator('#file-manager-status')).toContainText('1 / 4');
  await session.locator('.files-list').getByRole('treeitem', { name: 'README.md' }).click({ button: 'right' });
  await session.locator('#file-context-view').click();
  await expect(session.locator('#file-editor')).toBeVisible();
  expect(await session.locator('#file-editor').evaluate(dialog => {
    const rect = dialog.getBoundingClientRect();
    return dialog.matches(':modal') && rect.width >= Math.min(1000, innerWidth * .8) && rect.height >= innerHeight * .7;
  })).toBe(true);
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await session.locator('#file-editor-text').evaluate(textarea =>
      textarea.getBoundingClientRect().height > 80 && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expect(session.locator('#file-editor-text')).toHaveValue('line one\nline two\n');
  await expect(session.locator('#file-editor-text')).toHaveJSProperty('readOnly', true);
  await session.locator('#file-editor-edit').click();
  await session.locator('#file-editor-text').fill('line one\nchanged\n');
  await session.locator('#file-editor-save').click();
  await expect(session.locator('#file-editor-state')).toHaveText('已加载');
  expect(fixture.files.get('/root/README.md')).toEqual(Buffer.from('\ufeffline one\r\nchanged\r\n'));
  expect(fixture.calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'sftp_download', maxBytes: 1024 * 1024 }),
    expect.objectContaining({ type: 'sftp_upload_start', preserveMetadata: true }),
  ]));
  await session.locator('#file-editor-close').click();
  page.once('dialog', dialog => dialog.accept('created.conf'));
  await session.locator('#file-new').click();
  await expect(session.locator('#file-editor-state')).toHaveText('新文件草稿');
  expect(fixture.files.has('/root/created.conf')).toBe(false);
  await session.locator('#file-editor-text').fill('value=1\n');
  await session.locator('#file-editor-save').click();
  await expect(session.locator('#file-editor-state')).toHaveText('已加载');
  expect(fixture.files.get('/root/created.conf')?.toString()).toBe('value=1\n');
});

test('冲突阻止覆盖并保留草稿；关闭弹窗和会话需确认', async ({ page }) => {
  const fixture = await fileFixture(page);
  const session = await connectFiles(page);
  await session.locator('.files-list').getByRole('treeitem', { name: 'README.md' }).click({ button: 'right' });
  await session.locator('#file-context-edit').click();
  await session.locator('#file-editor-text').fill('my draft\n');
  fixture.files.set('/root/README.md', Buffer.from('changed elsewhere\n'));
  await session.locator('#file-editor-save').click();
  await expect(session.locator('#file-editor-message')).toContainText('远端文件已变化');
  await expect(session.locator('#file-editor-text')).toHaveValue('my draft\n');
  expect(fixture.files.get('/root/README.md')?.toString()).toBe('changed elsewhere\n');
  page.once('dialog', dialog => dialog.dismiss());
  await session.locator('#file-editor-close').click();
  await expect(session.locator('#file-editor')).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await session.locator('#file-editor-text').press('Escape');
  await expect(session.locator('#file-editor')).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('.session-tab-close').click();
  await expect(page.locator('.session-tab')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await session.locator('#file-editor-close').click();
  await expect(session.locator('#file-editor')).toBeHidden();
  await session.locator('#sftp-disconnect').click();
  await expect(session.locator('#sftp-connection-state')).toHaveText('SFTP 未连接');
});

test('新文件名称被占用时保留草稿', async ({ page }) => {
  const fixture = await fileFixture(page);
  const session = await connectFiles(page);
  page.once('dialog', dialog => dialog.accept('collision.conf'));
  await session.locator('#file-new').click();
  await session.locator('#file-editor-text').fill('draft=1\n');
  fixture.files.set('/root/collision.conf', Buffer.from('remote=2\n'));
  await session.locator('#file-editor-save').click();
  await expect(session.locator('#file-editor-message')).toContainText('File already exists');
  await expect(session.locator('#file-editor-text')).toHaveValue('draft=1\n');
  expect(fixture.files.get('/root/collision.conf')?.toString()).toBe('remote=2\n');
});

test('异常断线保留草稿，重连后仍检查远端版本', async ({ page }) => {
  const fixture = await fileFixture(page);
  const session = await connectFiles(page);
  await session.locator('.files-list').getByRole('treeitem', { name: 'README.md' }).click({ button: 'right' });
  await session.locator('#file-context-edit').click();
  await session.locator('#file-editor-text').fill('offline draft\n');
  fixture.sftpSockets[0].close({ code: 1011, reason: 'Interrupted' });
  await expect(session.locator('#file-editor-text')).toHaveValue('offline draft\n');
  await expect(session.locator('#sftp-connection-state')).toHaveText('SFTP 已连接', { timeout: 15000 });
  fixture.files.set('/root/README.md', Buffer.from('remote update\n'));
  await session.locator('#file-editor-save').click();
  await expect(session.locator('#file-editor-message')).toContainText('远端文件已变化');
  expect(fixture.files.get('/root/README.md')?.toString()).toBe('remote update\n');
});

test('无效 UTF-8、混合换行和超限文件不能编辑', async ({ page }) => {
  const fixture = await fileFixture(page);
  fixture.files.set('/root/README.md', Buffer.from([0xff, 0xfe]));
  const session = await connectFiles(page);
  await session.locator('.files-list').getByRole('treeitem', { name: 'README.md' }).click({ button: 'right' });
  await session.locator('#file-context-view').click();
  await expect(session.locator('#file-editor')).toBeHidden();
  await expect(session.locator('#file-manager-status')).toContainText('UTF-8');
  fixture.files.set('/root/README.md', Buffer.from('a\r\nb\n'));
  await session.locator('.files-list').getByRole('treeitem', { name: 'README.md' }).click({ button: 'right' });
  await session.locator('#file-context-view').click();
  await expect(session.locator('#file-editor')).toBeVisible();
  await expect(session.locator('#file-editor-edit')).toBeHidden();
  await session.locator('#file-editor-close').click();
  fixture.files.set('/root/README.md', Buffer.alloc(1024 * 1024 + 1, 65));
  fixture.directories.get('/root')![2].size = 1024 * 1024 + 1;
  await session.locator('#file-refresh').click();
  await session.locator('.files-list').getByRole('treeitem', { name: 'README.md' }).click();
  await session.locator('#file-more').click();
  await expect(session.locator('#file-context-view')).toBeDisabled();
  await expect(session.locator('#file-context-edit')).toBeDisabled();
  await expect(session.locator('#file-download')).toBeEnabled();
});

test('SSH 文件面板右键查看，双击下载', async ({ page }) => {
  const fixture = await fileFixture(page, { workbench: 'ssh' });
  const session = await connectFiles(page);
  await session.locator('#file-manager-tab').click();
  const row = session.locator('#file-table-body tr').filter({ hasText: 'README.md' });
  await row.click({ button: 'right' });
  await session.locator('#file-context-view').click();
  await expect(session.locator('#file-editor-text')).toHaveValue('hello files\n');
  await expect(session.locator('#file-editor')).toBeVisible();
  await session.locator('#file-editor-close').click();
  await row.dblclick();
  await expect.poll(() => fixture.calls.filter(call => call.type === 'sftp_download' && !call.maxBytes).length).toBe(1);
  await expect(session.locator('#file-editor')).toBeHidden();
});

test('SFTP 文件双击下载，工具栏菜单可打开编辑', async ({ page }) => {
  const fixture = await fileFixture(page);
  const session = await connectFiles(page);
  const row = session.locator('.files-list').getByRole('treeitem', { name: 'README.md' });
  await row.dblclick();
  await expect.poll(() => fixture.calls.filter(call => call.type === 'sftp_download' && !call.maxBytes).length).toBe(1);
  await expect(session.locator('#file-editor')).toBeHidden();
  await row.click();
  await session.locator('#file-more').click();
  await expect(session.locator('#file-context-menu')).toBeVisible();
  await expect(session.locator('#file-context-view')).toBeFocused();
  await session.locator('#file-context-view').press('ArrowDown');
  await expect(session.locator('#file-context-edit')).toBeFocused();
  await session.locator('#file-context-edit').press('Escape');
  await expect(session.locator('#file-context-menu')).toBeHidden();
  await expect(session.locator('#file-more')).toBeFocused();
  await session.locator('#file-more').click();
  await session.locator('#file-context-edit').click();
  await expect(session.locator('#file-editor')).toBeVisible();
  await expect(session.locator('#file-editor-text')).toHaveJSProperty('readOnly', false);
});
