# D1 数据库迁移

导航：[README.md](../../migrations/README.md) · [根索引](../../AGENTS.md)

## 数据模型

| 迁移 | 表与目的 |
| --- | --- |
| `0001_accounts.sql` | hosts：id、account_id、encrypted_payload、updated_at 与所有者索引 |
| `0002_workspace_state.sql` | 单行 workspace_state：固定 account_id、provider、认证 revision、撤销时间、GitHub 数字 ID |
| `0003_snippets.sql` | snippets 加密记录及 snippet_libraries 首次初始化标记 |
| `0004_forward_rules.sql` | forward_rules 加密记录与账户更新时间索引 |
| `0005_workspace_settings.sql` | workspace_settings：非敏感 settings_json、revision、updated_at |

`0002` 在旧 hosts 表有至多一个所有者时沿用原 account_id，空库使用 admin；多所有者库不自动初始化工作区，由部署流程显式处理。这关系到密文 AAD，不能通过重新分配所有者修复部署。

## 入口与约束

根 `wrangler.toml` 的 D1 绑定为 `DB`，`migrations_dir` 指向本目录；`scripts/deploy.ts` 在正式发布流程应用远程迁移，本地开发使用 Wrangler 的 `d1 migrations apply DB --local`。

- 持久化契约与 [src/accounts](../../src/accounts/README.md)、[scripts/workspace-state.ts](../../scripts/workspace-state.ts) 一起检查。
- 新增 schema 使用顺序编号的新迁移，避免改写已应用迁移来描述升级。迁移必须保留现有工作区 ID 与密文。
- 不把非敏感设置表误作加密主机表，不绕过 revision 的原子比较写入。
- SQLite/D1 差异、首次安装和已有数据升级要分别验证。远程迁移会写外部状态，须按当前用户授权执行。

## 验证定位

`tests/settings.test.ts` 覆盖前序迁移与设置迁移保留主机；snippets、forward-rules、oauth 和 deployment 测试也使用/检查迁移或工作区状态。已有测试使用内存 SQLite 模拟 D1。
