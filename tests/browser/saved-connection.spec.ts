import { test, expect } from '@playwright/test';

const host = {
  id: 'alpha', name: 'Tokyo production', host: '192.0.2.10', port: 22, username: 'root',
  group: '生产环境', authMethod: 'password', initialCommand: '', termType: 'xterm-256color',
  encoding: 'utf-8', fingerprint: '', location: null, system: null,
  hasCredential: true, updatedAt: Date.now(),
};

for (const fail of [false, true]) {
  test(`工作台已保存主机即时反馈、避免重复读取并保持完整布局：${fail ? '凭据失败' : '连接成功'}`, async ({ page }) => {
    let credentialReads = 0;
    let releaseCredentials!: () => void;
    const credentialsGate = new Promise<void>((resolve) => { releaseCredentials = resolve; });
    const connections: Array<Record<string, unknown>> = [];
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/me') return route.fulfill({ json: { account: { username: 'local-development' }, provider: 'local-dev' } });
      if (path === '/api/hosts') return route.fulfill({ json: { hosts: [host] } });
      if (path.endsWith('/credentials')) {
        credentialReads++;
        await credentialsGate;
        return fail
          ? route.fulfill({ status: 500, json: { error: '测试凭据读取失败' } })
          : route.fulfill({ json: { password: 'test-password' } });
      }
      if (path === '/api/session') return route.fulfill({ json: { ticket: 'test-ticket', sessionId: 'test-session' } });
      return route.fulfill({ json: {} });
    });
    await page.routeWebSocket('**/api/ssh?*', (ws) => {
      ws.onMessage((raw) => {
        if (typeof raw !== 'string') return;
        const message = JSON.parse(raw) as Record<string, unknown>;
        if (message.type !== 'connect') return;
        connections.push(message);
        ws.send(JSON.stringify({ type: 'ready' }));
      });
    });
    await page.goto('/');
    await page.locator('#session-new').click();
    const session = page.frameLocator('#session-frame-host iframe');
    const connect = session.getByRole('button', { name: `连接 ${host.name}`, exact: true });
    await connect.click();
    await expect(session.locator('#connection-panel')).toBeHidden();
    await expect(session.locator('#terminal-card')).toBeVisible();
    await expect(session.locator('#terminal-empty')).toBeHidden();
    await expect(session.locator('#session-subtitle')).toHaveText('正在读取主机凭据…');
    await expect(page.locator('.session-tab-label')).toHaveText(host.name);
    // 面板已收起，模拟排队的重复点击以验证异步读取保护。
    await session.getByRole('button', { name: `连接 ${host.name}`, exact: true, includeHidden: true })
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect.poll(() => credentialReads).toBe(1);
    releaseCredentials();

    if (fail) {
      await expect(session.locator('#form-error')).toHaveText('测试凭据读取失败');
      await expect(session.locator('#session-subtitle')).toHaveText('测试凭据读取失败');
      await expect(session.locator('#connection-panel')).toBeHidden();
      await expect(session.locator('.toast.error')).toHaveText('测试凭据读取失败');
      expect(connections).toEqual([]);
      return;
    }
    await expect.poll(() => connections.length).toBe(1);
    await expect(session.locator('#connection-panel')).toBeHidden();
    await expect(session.locator('#session-title')).toHaveText(host.name);
    await expect(page.locator('.session-tab-label')).toHaveText(host.name);
    const layout = await session.locator('#terminal-card').evaluate((card) => {
      const bounds = card.getBoundingClientRect();
      return {
        insideApp: document.querySelector('#app')!.contains(card),
        top: bounds.top, bottom: bounds.bottom, height: bounds.height,
        viewport: window.innerHeight, scrollHeight: document.body.scrollHeight,
      };
    });
    expect(layout.insideApp).toBe(true);
    expect(layout.top).toBeLessThanOrEqual(20);
    expect(layout.bottom).toBeLessThanOrEqual(layout.viewport);
    expect(layout.height).toBeGreaterThan(layout.viewport * 0.8);
    expect(layout.scrollHeight).toBeLessThanOrEqual(layout.viewport);
  });
}
