# 浏览器工作台

导航：[README.md](../../frontend/README.md) · [根索引](../../AGENTS.md)

## 职责与入口

`index.html` 定义主要页面与稳定 DOM ID，`src/language-bootstrap.ts` 提前处理语言，`src/main.ts` 初始化应用外壳、终端、连接表单、会话标签及各工作台。构建配置位于根 `vite.config.ts`，输出到根 `dist/`，无需单独安装依赖。

总体使用原生 DOM、事件与类；`src/file-list.tsx` 使用 React/react-arborist 为文件列表提供虚拟化，不能据此把整个应用理解为 React SPA。每个 SSH/SFTP 标签使用同源 iframe 隔离会话状态，父页面通过 `postMessage` 同步语言、主题和设置；保留消息来源与 Origin 检查。

## 功能地图

| 文件 | 主要责任 |
| --- | --- |
| `src/main.ts`、`src/ui-state.ts` | 会话创建、导航、连接状态、Host Key 对话框与父子消息 |
| `src/cloud-api.ts`、`src/dashboard.ts` | 同源 API、云端主机管理、Dashboard |
| `src/terminal-tools.ts`、`src/terminal-session.ts`、`src/ws-reconnect.ts` | 终端工具、连接重置、可控重连 |
| `src/file-manager.ts`、`src/file-tree.ts`、`src/file-list-view.ts`、`src/file-list.tsx` | SFTP 操作、目录树与列表契约 |
| `src/sftp-workbench.ts`、`src/process-manager.ts` | SFTP 专用标签、终端分隔条与进程监控 |
| `src/settings-store.ts`、`src/settings-page.ts` | 工作区设置快照、手动保存、草稿与冲突 UI |
| `src/snippet-store.ts`、`src/snippets.ts`、`src/snippet-*.ts` | 命令片段管理、浮窗、编辑及插入行为 |
| `src/forward-page.ts` | 云端转发规则、标准/隔离模式和短期恢复句柄 |
| `src/history.ts`、`src/history-key.ts`、`src/password-crypto.ts` | 临时连接历史、IndexedDB 密钥与加密密码 |
| `src/ssh-keygen.ts`、`src/bcrypt-pbkdf.ts` | OpenSSH Ed25519 私钥生成及口令加密 |
| `src/globe.ts`、`src/flags.ts`、`src/os-icons.ts` | Canvas 地球、国家旗帜与系统图标 |

## API、状态与安全契约

- `cloud-api.ts` 使用同源 Cookie；非 JSON 或 401 会触发 `auth-required`，相关 store 清空状态。共享设置与片段类型来自 `../src/accounts/*-data.ts`，保持浏览器可执行的纯数据/验证代码，不引入 Worker 专属绑定。
- 连接顺序为申请 `/api/session` 票据，再连接 `/api/ssh`；服务器确认主机指纹后才继续 SSH 认证。辅助 SFTP/进程 URL 来自主会话授权，不能由任意输入拼装替代。
- 设置由父页面读取和保存，通过快照同步给 iframe；字号/光标可影响已有终端，编辑器默认开关只影响新会话。草稿必须在请求失败与版本冲突时保留。
- 单行片段可按设置插入终端，但不追加回车；多行片段进入编辑器确认。`snippet-action.ts` 是插入目标的集中判断入口。
- 临时历史可保存加密密码，AES-GCM 密钥以不可导出的 CryptoKey 存入 IndexedDB；不要改成明文、本机日志或可分享 URL。云端凭据与临时历史是不同路径，不能假定浏览器完全无持久存储。
- SFTP 单文件上限 64 MiB，上传块 64 KiB，与后端一致。取消、断开和切换主机要阻止迟到结果重启旧会话。
- `?demo` 使用前端演示数据；`DEV_AUTH` 属于 Worker 本地认证配置。演示设置仅存本页内存。

## 样式与验证

颜色变量集中在 `src/colors.css`，首页沿用橙色、工作台沿用薄荷绿，并区分表面、控件边框、按钮文字、选中和语义状态色。`src/style.css` 与组件样式消费这些变量；终端输出和命令输入使用独立的固定深色变量，Canvas 在主题变化后重绘。主样式为 `src/style.css`，功能样式与组件并列；保留主题变量、中英文、键盘导航、375px 手机及更窄视口行为。`public/flags/` 是静态资源，`src/vendor/` 是 vendored 依赖，不做无关批量修改。

首页与终端页的目标配色、表面层次和自动／浅色／暗色选择规则见[颜色模式设计](../design/COLOR_MODES.md)。语义颜色和明暗表面已实现；自动模式、三项菜单及首屏主题初始化尚未实现，当前仍为浅色／暗色切换。文档中单独列出剩余差距与实施验收要求。

从根运行 `npm run typecheck`、`npm run build:web`；行为改动选择 `tests/browser/` 中对应的 settings、files、dashboard、snippets、navigation、forwarding 或 ssh-failure 用例。测试模拟 API/WebSocket，不能替代真实服务器验证。
