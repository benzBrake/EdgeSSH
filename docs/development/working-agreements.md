# 开发约定

导航：[根索引](../../AGENTS.md) · [架构总览](../architecture/overview.md)

## 修改方式

- 若工作目录或相关子目录存在 `AGENTS.local.md`，优先遵循其适用约定；冲突时以本地文件为准。
- 先核对共享类型、调用方和相关测试；保持原生 DOM/局部 React、Worker、DO 与协议层的现有边界，避免重复状态或验证器。
- 匹配周边命名、导入扩展名、错误处理和注释习惯；只改任务相关内容，不做无关格式化。
- 优先采用满足需求的最小实现。不能正确处理时应显式失败，避免静默降级、吞错或无限重试。
- 保持文档和源码事实一致；以当前源码和可执行验证为准，README 或索引中的旧描述不能替代代码核对。

## 安全与外部状态

- 不输出凭据、令牌、完整环境或敏感配置；不要读取 `.dev.vars`、`.env*` 或生成部署配置来补充文档。
- 不将密钥作为命令行参数传递；诊断只查询必要字段。
- 认证、一次性授权、指纹确认、请求边界、SSRF 检查和密文 AAD 都是安全契约；变更时核对对应架构文档及测试。
- 不覆盖无关用户改动。Git 写操作、PR 写操作和外部状态写入只在用户明确授权的范围内执行；代码修改不代表提交授权。
- 部署、远程迁移、Cloudflare 配置和工作流触发可能修改外部状态，先确认当前请求是否明确授权。

## 本地开发命令

Node.js 要求 `>=22.12.0`，使用 `fnm` 管理；依赖由根目录 npm 锁文件管理。常用命令从仓库根目录运行：

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按锁文件安装依赖 |
| `npm run dev` | Wrangler 本地 Worker（配置会构建前端） |
| `npm run dev:preview` | 本地隔离预览 Worker，监听协议与端口由 `.dev.vars` 推导 |
| `npm run dev:web` | Vite 前端，API/WebSocket 代理到本地 Worker |
| `npm run build:web` | 构建前端到根 `dist/` |
| `npm run typecheck` | 检查 Worker、前端和部署脚本 |
| `npm test` | Node 单元与协议测试 |
| `npm run test:browser` | Playwright 桌面与手机回归 |
| `npm run check` | 类型检查、单元测试和 Wrangler 部署 dry-run |

本地 D1 迁移方式见[数据库说明](../architecture/database.md)和 [README](../../README.md)。`DEV_AUTH=true` 仅用于本地免登录，仍调用真实本地 API；`?demo` 是独立的前端内存演示模式。Python 工具使用 `uv`。

## 文档格式

新文本使用 UTF-8 无 BOM、LF。根 `AGENTS.md` 维护 agent 阅读要求和项目导航；模块 `README.md` 维护职责简介、入口与导航链接，详细说明维护在 `docs/`。这些是公开的仓库文档；本机约定放在各层级 `AGENTS.local.md` 中，由 `.gitignore` 忽略。未经用户明确授权，不自动暂存文档。
