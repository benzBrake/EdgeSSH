# GitHub Actions 工作流

导航：[README.md](../../.github/workflows/README.md) · [根索引](../../AGENTS.md)

## 工作流与入口

| 文件 | 职责 |
| --- | --- |
| `ci.yml` | dev push 和任意来源的 main PR；类型、单元、构建及桌面/手机浏览器检查 |
| `deploy.yml` | main push、手动触发与可复用调用；校验已合入 main 的提交后部署 Cloudflare |
| `deploy-preview.yml` | 手动调用可复用 Deploy，设置 deploy_preview=true |
| `force-update.yml` | 定时/手动查官方发布标记，按规则更新远端 main 后触发部署 |

CI 与 Deploy 使用 Ubuntu runner、Node 22.12.0。CI 执行 npm ci、npm run check、安装 Chromium 并执行桌面/手机浏览器回归，不使用部署凭据；PR 默认检出合并结果，检查名为 `PR checks`，dev push 为 `Dev checks`。Deploy 先确认调用来自 main、目标提交已包含在 main 历史中，再执行 npm ci、deploy:validate 和 npm run deploy，不重复完整 CI。实际部署与密钥保留逻辑集中在 [scripts](../../scripts/README.md)，工作流负责输入与环境映射，不另建一套资源配置逻辑。

## 修改约束与风险

- Variables/Secrets 名称、workflow_call 输入与 deployment-config.ts 同步；GitHub 认证参数使用 `GH_*`，避免 GitHub 保留的 `GITHUB_*` 自定义变量前缀。
- 不输出 secrets 表达式的展开值或完整运行环境。Secret 值由部署工具经 stdin 写入 Worker，不能改为命令行参数或临时配置明文。
- 普通部署只更新主 Worker，隔离预览必须显式走 preview workflow；preview 的独立域名和绑定限制由生成器与 forwarding/security 验证。
- Force Update 包含 `git push --force-with-lease` 远程写入 main，可能替换用户自定义改动；这与普通检查不同，阅读/编辑工作流不等于授权执行或触发。
- 保留现有 permissions、复用输入与秘密传递关系；新增触发器或扩大权限需有当前任务依据，不能为了索引自动运行 Actions。

## 验证

部署配置、触发边界与认证流程由 `tests/deployment*.test.ts` 覆盖。真实站点登录和 SSH/SFTP 互操作需要单独验收。
