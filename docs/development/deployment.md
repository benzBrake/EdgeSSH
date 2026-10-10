# 部署与演示工具

导航：[README.md](../../scripts/README.md) · [根索引](../../AGENTS.md)

## 入口与依赖

`deploy.ts` 是 `npm run deploy`/`deploy:validate` 的入口；Node 使用 TypeScript stripping，tsconfig.scripts 采用 NodeNext、严格类型与 erasable syntax。文件间导入使用 `.ts` 扩展名，依赖根 npm 安装、smol-toml 与本地 Wrangler。`generate-showcase.mjs` 是独立的 Playwright 演示截图工具。

| 文件 | 职责 |
| --- | --- |
| `deployment-config.ts` | 读取/校验参数、主 Worker 与 preview 的临时配置生成 |
| `cloudflare-api.ts` | Cloudflare HTTP API、分页、账户选择与安全异常 |
| `cloudflare-d1.ts` | 查找或创建 D1 数据库 |
| `cloudflare-access.ts` | Worker 域名/账户子域、Access 应用与策略管理 |
| `deployment-auth.ts` | GitHub 管理员数字 ID 或 Access 认证准备 |
| `deployment-secrets.ts` | 读取 Secret 名称、保留已有加密密钥、必要时生成新密钥 |
| `workspace-state.ts` | 兼容旧库、固定工作区所有者、认证切换与 revision 更新 |

## 部署流程与副作用

validate-only 在解析模板并校验部署输入后返回，不能当作实际账户权限或远端可用性验收。正式部署先解析账户/现有 Worker、域名与 preview、数据库和工作区，准备认证与加密秘密，再写根临时 `.wrangler.generated.toml`，应用远程迁移，通过 stdin 批量写 Secret、发布主 Worker、更新工作区状态并复核 Secret 名称；显式启用时另外生成 preview 配置并发布 preview。

正式部署会创建/修改 Cloudflare、D1、Access 和 Worker 状态，不是可任意运行的本地检查。`force-update.yml` 则有额外 Git 远程写入，详见 [工作流](../../.github/workflows/README.md)。未经当前用户明确授权不执行这些外部写操作。

## 安全与维护约束

- 已存在加密密钥必须保留；库内已有密文但密钥缺失是硬失败，不能随机生成新密钥掩盖故障。
- Secret 经 stdin 传给 Wrangler，不能写临时文件或放命令行参数；生成 TOML 不包含运行时 Secret。诊断只读取所需字段/名称，不输出完整配置或环境。
- API 权限错误或读取失败不能一律当作资源不存在；保留错误根因并防止危险自动重建。
- provider 切换保持固定 accountId；已有认证配置/管理员身份的保留逻辑与 accounts/workspace 使用方一致。
- preview 只绑定主 SSH_SESSIONS，不能获得 D1、静态资源或秘密；普通部署保留现有 PREVIEW_ORIGIN，但不会自动更新 preview 代码。
- generate-showcase 使用虚构主机、保留地址和 mock API/Socket；输出 docs/images/showcase，禁止用真实凭据/真实服务器生成宣传截图。

## 验证

对应 `tests/deployment.test.ts`、`deployment-bootstrap.test.ts`、`deployment-auth.test.ts`，以及根 `npm run typecheck`。部署测试通过模拟 fetch 校验配置、权限/失败、密钥保留与工作区迁移，不要求真实 token。
