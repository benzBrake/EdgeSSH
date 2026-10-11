# Worker 入口与共享契约

导航：[README.md](../../src/README.md) · [根索引](../../AGENTS.md)

## 入口与依赖

`worker.ts` 是主 Worker，导出 `SSHSessionDO` 并处理认证、API、WebSocket 升级、标准转发与静态资源。`preview-worker.ts` 是独立站点的隔离预览入口，只通过 DO binding 调用预览能力。`types.ts` 包含 SSH 常量、`Env`、连接配置及 `parseConnectMessage`；`http-security.ts` 管理主应用响应安全头与 Origin 检查。

主绑定为 `DB`、`SSH_SESSIONS`、`ASSETS`；名称与 `wrangler.toml`、部署配置生成器一致。预览 Worker 不应获得 D1、ASSETS、主站认证或加密密钥。

## 路由地图

| 对外路径 | 分派位置与约束 |
| --- | --- |
| `/api/health` | 主 Worker 健康响应 |
| `/auth/*`、`/api/auth/*` | accounts/auth-routes 与 currentAccount |
| `/api/hosts*`、`/api/snippets*`、`/api/settings*`、`/api/forward-rules*` | 相应 accounts API，要求管理员认证 |
| `POST /api/session` | 创建 DO 与短期一次性票据；JSON 请求体只接受空对象 |
| `GET /api/ssh` | WebSocket 升级，校验 Origin、票据与 DO ID |
| `GET /api/sftp`、`GET /api/processes` | 经认证的辅助通道升级，使用专用 attachment token |
| `/api/forwarding`、`/_forward/*` | forwarding 管理与标准模式代理 |
| 其他非 API 路径 | ASSETS 静态资源；不存在 API 返回 404 |

预览 Worker 的 `/__edgessh/start` 用 fragment 交接一次性能力，`/__edgessh/launch` 兑换 HttpOnly Cookie，其他预览请求调用 DO `/preview-http`。不要把这些内部能力直接暴露为主站匿名 API。

## 修改约束与子模块

- [accounts](../../src/accounts/README.md)：认证、数据 API、纯共享数据与验证。
- [backend](../../src/backend/README.md)：DO 与会话协调。
- [ssh](../../src/ssh/README.md)：二进制协议实现。
- [forwarding](../../src/forwarding/README.md)：代理与预览授权。
- 主 API 写操作要求同源 Origin；WebSocket 也单独校验 Origin。主 Worker 覆盖内部账户与 attachment 头，转发请求不能信任浏览器提供的内部路由头。
- `corsResponse` 必须原样放行带 `webSocket` 的升级响应，重新包装 101 会破坏 Cloudflare 握手。
- 标准转发保留目标网站的 CSP，不套主应用 CSP；增加路由时核对认证发生顺序与异常响应路径。

类型检查使用根 `tsconfig.worker.json`。Worker 专用 API 如 `cloudflare:sockets`、DO、D1 不适合直接在 Node 执行；沿用现有测试的 mock/bundle 方式。
