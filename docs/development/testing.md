# 测试与验证入口

导航：[README.md](../../tests/README.md) · [根索引](../../AGENTS.md)

## 运行方式

根 `npm test` 使用 Node 原生 test runner，启用 `--experimental-strip-types --experimental-sqlite`，只匹配 `tests/*.test.ts`。根 `npm run test:browser` 使用 `playwright.config.ts`，匹配 `tests/browser`，自动启动 Vite；desktop 为 1440×1000，mobile 为 375×812，默认 locale zh-CN。`PLAYWRIGHT_CHANNEL` 可选择已安装浏览器通道。

项目没有额外独立测试包。类型检查分别覆盖 Worker、前端、scripts；scripts tsconfig 只额外纳入 deployment*.test.ts，不能将 typecheck 成功理解为所有测试文件均受同样类型检查。

## 测试地图

| 范围 | 文件 |
| --- | --- |
| 认证与加密 | auth、oauth、encryption |
| 云端数据与设置 | snippets、settings、forward-rules、location |
| SSH 与终端行为 | ssh-session-failure、ssh-keygen、ws-reconnect、terminal-tools、system-info、file-kind |
| 转发协议与授权 | forwarding-auth/http/protocol/routes/mounted/failure |
| 发布编排 | deployment、deployment-bootstrap、deployment-auth |
| 浏览器工作台 | browser/dashboard、navigation、saved-connection、settings、snippets、terminal-tools、ssh-failure |
| 浏览器 SFTP 与转发 | browser/files、forwarding、forwarding-runtime、共享 file-fixture |

上表省略后缀：根测试为 `.test.ts`，浏览器测试为 `.spec.ts`；`browser/file-fixture.ts` 是共享辅助文件。

## 测试设计与边界

- 数据 API 测试用 `node:sqlite` 内存库和 D1 形状的 adapter；迁移 SQL 从真实文件加载，保持账户隔离、密文与版本冲突等行为断言。
- 部分 Worker/SSH 测试用 esbuild 内存 bundle 解析现有省略扩展名的导入，并按需 mock `cloudflare:sockets`；不要为 Node 测试改写生产认证或真实网络连接路径。
- 浏览器 fixture 模拟 API/WebSocket，用于字节、状态、布局和交互回归；不访问真实 SSH 主机，不代表真实 Cloudflare 运行时或 SSH 互操作已经通过。
- 扩展测试时优先保护可观察行为与根因；取消、重连、迟到响应、草稿、指纹确认、不同模式和边界数据是关键回归点。低影响文档改动不新增镜像实现的测试。
- 运行本地单项 Node 用例时保留与 package.json 相同的实验性参数；浏览器单项可用 `npm run test:browser -- tests/browser/<name>.spec.ts`。先执行与变更相关的检查，再按实际风险决定是否运行完整 check。
