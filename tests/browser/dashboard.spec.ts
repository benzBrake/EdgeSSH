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
