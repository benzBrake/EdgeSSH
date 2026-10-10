import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/accounts/settings-data';

async function navigationFixture(page: Page, path = '/') {
  const host = {
    id: 'navigation-host', name: 'Navigation server', host: '192.0.2.10', port: 22, username: 'root',
    group: '', authMethod: 'password', initialCommand: '', termType: 'xterm-256color',
    encoding: 'utf-8', fingerprint: '', location: null, system: null,
    hasCredential: true, updatedAt: Date.now(),
  };
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/settings') return route.fulfill({ json: { settings: DEFAULT_SETTINGS, revision: 0, updatedAt: 0 } });
    if (pathname === '/api/auth/me') return route.fulfill({ json: { account: { username: 'local-development' }, provider: 'local-dev' } });
    if (pathname === '/api/hosts') return route.fulfill({ json: { hosts: [host] } });
    if (pathname.endsWith('/credentials')) return route.fulfill({ json: { password: 'test-password' } });
    if (pathname === '/api/session') return route.fulfill({ json: { ticket: 'test-ticket', sessionId: 'test-session' } });
    return route.fulfill({ json: {} });
  });
  await page.goto(path);
  await expect(page.locator('#host-list .host-row')).not.toHaveCount(0);
}

test('品牌、动态主页链接和会话内主页链接切换视图，保留 SSH 连接', async ({ page }) => {
  let connections = 0;
  await page.routeWebSocket('**/api/ssh?*', (ws) => {
    ws.onMessage((raw) => {
      if (typeof raw === 'string' && JSON.parse(raw).type === 'connect') {
        connections++;
        ws.send(JSON.stringify({ type: 'ready' }));
      }
    });
  });
  await navigationFixture(page);
  await page.locator('#host-list').getByRole('button', { name: '连接', exact: true }).click();
  const iframe = page.locator('#session-frame-host iframe');
  const session = page.frameLocator('#session-frame-host iframe');
  await expect(session.locator('#session-title')).toHaveText('Navigation server');
  await expect.poll(() => connections).toBe(1);
  const frameId = await iframe.getAttribute('id');
  const navigationRequests: string[] = [];
  page.on('request', (request) => { if (request.isNavigationRequest()) navigationRequests.push(request.url()); });

  for (const entry of ['brand-click', 'brand-keyboard', 'dynamic-link', 'frame-link']) {
    if (entry === 'brand-click') await page.locator('.home-brand .brand-chevron').click();
    else if (entry === 'brand-keyboard') await page.locator('.home-brand').press('Enter');
    else if (entry === 'dynamic-link') {
      await page.evaluate(() => {
        const link = document.createElement('a');
        link.id = 'dynamic-home';
        link.href = location.origin + '/';
        link.innerHTML = '<svg width="24" height="24"><circle cx="12" cy="12" r="10" /></svg>';
        document.querySelector('#session-tabs')!.append(link);
      });
      await page.locator('#dynamic-home circle').click();
    } else await session.locator('a.brand').evaluate((link: HTMLAnchorElement) => link.click());
    await expect(page.locator('#dashboard')).toBeVisible();
    await expect(page.locator('#session-home')).toHaveAttribute('aria-current', 'page');
    await expect(iframe).toHaveAttribute('id', frameId!);
    await expect(page.locator('.session-tab')).toHaveCount(1);
    await page.locator('.session-tab').click();
    await expect(session.locator('#terminal-card')).toBeVisible();
    await expect(session.locator('#live-orb')).toHaveClass('live-orb connected');
  }
  expect(connections).toBe(1);
  expect(navigationRequests).toEqual([]);
});

test('主页链接沿用未保存设置确认，取消时保留草稿', async ({ page }) => {
  await navigationFixture(page);
  await page.locator('#rail-settings').click();
  const settings = page.locator('#settings-page');
  await settings.getByLabel('终端字号').fill('18');
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('放弃未保存的设置修改？');
    await dialog.dismiss();
  });
  await page.locator('.home-brand').click();
  await expect(settings).toBeVisible();
  await expect(settings.getByLabel('终端字号')).toHaveValue('18');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.home-brand').click();
  await expect(page.locator('#dashboard .home-content')).toBeVisible();
  await expect(settings).toBeHidden();
});

test('主页链接保留当前工作台 URL 参数', async ({ page }) => {
  await navigationFixture(page, '/?demo=1');
  const url = page.url();
  await page.locator('#rail-snippets').click();
  await page.locator('.home-brand').click();
  await expect(page.locator('#dashboard .home-content')).toBeVisible();
  await expect(page).toHaveURL(url);
});

test('链接监听保留外链、认证、下载、锚点和新窗口操作', async ({ page }) => {
  await navigationFixture(page);
  const prevented = await page.evaluate(() => {
    const cases = [
      { href: '/' },
      { href: '/', target: '_self' },
      { href: 'https://example.com/' },
      { href: '/auth/login' },
      { href: '/api/auth/logout' },
      { href: '/', download: true },
      { href: '/', target: '_blank' },
      { href: '/', target: '_top' },
      { href: '#dashboard' },
      { href: '/?sessionFrame=1' },
      { href: '/', ctrlKey: true },
      { href: '/', metaKey: true },
      { href: '/', shiftKey: true },
      { href: '/', altKey: true },
      { href: '/', button: 1 },
      { href: '/', handled: true },
    ];
    return cases.map((item) => {
      const link = document.createElement('a');
      link.href = item.href;
      if (item.target) link.target = item.target;
      if (item.download) link.download = '';
      document.body.append(link);
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...item });
      if (item.handled) event.preventDefault();
      let intercepted = false;
      // Observe after the document handler, then prevent actual navigation in this test.
      window.addEventListener('click', (event) => { intercepted = event.defaultPrevented; event.preventDefault(); }, { once: true });
      link.dispatchEvent(event);
      link.remove();
      return intercepted;
    });
  });
  expect(prevented).toEqual([true, true, ...Array(13).fill(false), true]);
});
