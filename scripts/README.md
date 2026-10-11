# 部署与演示工具

导航：[项目索引](../AGENTS.md) · [工作流](../.github/workflows/README.md)

本目录负责编排 Cloudflare 部署、工作区初始化和演示截图生成。

`dev-preview.ts` 负责本地预览 Worker 启动，从根 `.dev.vars` 的 `PREVIEW_ORIGIN` 推导监听协议和端口；运行方式见根 [README](../README.md#本地开发)。

部署流程、副作用、安全约束与验证入口见[部署工具说明](../docs/development/deployment.md)。
