# 认证与工作区数据

导航：[README.md](../../src/accounts/README.md) · [根索引](../../AGENTS.md)

## 职责与身份模型

主 Worker 在路由分派前调用 `currentAccount`。生产认证为 Cloudflare Access 或 GitHub OAuth，两者进入 D1 `workspace_state` 中固定的同一个 `accountId`；显示用户名不是数据所有者标识。`DEV_AUTH=true` 返回本地身份 `local-development`，仅用于本地开发。

`auth-provider.ts` 判定 provider，`auth.ts` 验证身份与已部署工作区状态，`access-token.ts` 提取 Access Token，`github-auth.ts` 负责 OAuth state、PKCE、签名 Cookie 与管理员数字 ID 验证，`auth-routes.ts` 分派登录/回调/注销。Access 使用 `jose` 校验 JWK 签名、issuer、audience、必需 claims 与撤销时间，不能以邮箱请求头代替 JWT。

## API 与数据

| 文件 | 路由/职责 |
| --- | --- |
| `hosts.ts` | `/api/hosts` CRUD、按需读取 credentials、刷新 location、更新 system |
| `snippets.ts`、`snippet-data.ts` | `/api/snippets` 加密命令库及默认片段 |
| `forward-rules.ts` | `/api/forward-rules` 加密规则，检查所属主机 |
| `settings.ts`、`settings-data.ts` | `/api/settings` GET/PUT、设置 schema、快照与版本校验 |
| `workspace.ts` | 单行工作区状态、认证 revision 与会话撤销 |
| `crypto.ts` | 加密、解密与摘要 |
| `http.ts` | `APIError`、有界 JSON 读取、统一 JSON/失败响应 |
| `location.ts` | 公网地址定位，复用 backend 的地址检查 |

主机、片段、转发规则均使用 AES-256-GCM；`v1` 密文格式的 AAD 绑定工作区与记录标识，片段/规则用独立前缀隔离。查询与修改均需限制 `account_id`，不能只凭记录 ID 授权。主机列表不返回秘密，credentials 单独按需读取。

设置是非敏感 JSON，不走上述加密格式。读取不存在记录返回 revision 0 默认快照；第一次保存用条件 INSERT，之后按 revision 条件 UPDATE，冲突返回 409。`settings-data.ts` 与 `snippet-data.ts` 被前端引用，必须保持平台无关。

## 不变量

- 单管理员、无公开注册与租户角色体系；切换 provider 不改变 accountId/AAD。`workspace_state` 缺失或 provider 不匹配必须显式失败。
- 首次命令库初始化把默认记录和标记放进同一 D1 batch；用户删空后不能重新补默认项。
- 主机、片段、转发规则各有 200 条上限；保留现有输入边界和原子条件写入。
- 删除主机后规则可保留，但新的规则写入必须验证主机所属；界面负责显示不可连接状态。
- 不改变加密密钥格式或直接轮换已有生产密钥；密文与 schema 改动需同时检查 [migrations](../../migrations/README.md) 与部署脚本。

## 验证定位

对应 `tests/auth.test.ts`、`oauth.test.ts`、`encryption.test.ts`、`location.test.ts`、`snippets.test.ts`、`settings.test.ts`、`forward-rules.test.ts`。数据库测试通过内存 SQLite 模拟 D1。前端行为对应 settings/snippets/forwarding/browser 回归。
