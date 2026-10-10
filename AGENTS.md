# EdgeSSH 项目导航

EdgeSSH 是部署在 Cloudflare 上的单管理员 WebSSH 工作台。此文件提供 agent 阅读要求和项目导航；详细协作约定和技术说明见下列文档。

## 修改前阅读

- 修改源码前，先阅读[开发约定](docs/development/working-agreements.md)，再阅读目标目录及其相关父目录中的 `README.md`，并按其中链接查看相关设计与测试说明。
- 跨模块修改需阅读所有受影响模块的文档；文档与源码不一致时，以当前源码和验证结果为准。

## 项目文档

- [架构总览与模块设计](docs/architecture/overview.md)
- [开发约定](docs/development/working-agreements.md)
- [测试与验证](docs/development/testing.md)
- [部署工具](docs/development/deployment.md) · [GitHub Actions](docs/development/workflows.md)
- [用户文档](README.md) · [部署指南](DEPLOYMENT.md) · [Zero Trust](docs/ZERO_TRUST.md)

## 模块索引

| 路径 | 职责 | 详细说明 |
| --- | --- | --- |
| [frontend](frontend/README.md) | 浏览器工作台 | [前端设计](docs/architecture/frontend.md) |
| [src](src/README.md) | Worker 入口与共享契约 | [Worker 设计](docs/architecture/workers.md) |
| [src/accounts](src/accounts/README.md) | 认证与工作区数据 | [账户与数据](docs/architecture/accounts-and-data.md) |
| [src/backend](src/backend/README.md) | DO 与 SSH 会话 | [SSH 会话](docs/architecture/ssh-sessions.md) |
| [src/ssh](src/ssh/README.md) | SSH 与 SFTP 协议 | [协议实现](docs/architecture/ssh-protocol.md) |
| [src/forwarding](src/forwarding/README.md) | HTTP 端口转发 | [转发设计](docs/architecture/forwarding.md) |
| [migrations](migrations/README.md) | D1 数据库迁移 | [数据库说明](docs/architecture/database.md) |
| [scripts](scripts/README.md) | 部署与演示工具 | [部署工具](docs/development/deployment.md) |
| [tests](tests/README.md) | 单元、协议与浏览器测试 | [测试说明](docs/development/testing.md) |
| [.github/workflows](.github/workflows/README.md) | CI 与发布工作流 | [工作流说明](docs/development/workflows.md) |
