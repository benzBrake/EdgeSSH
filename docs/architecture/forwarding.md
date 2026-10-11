# HTTP 端口转发

导航：[README.md](../../src/forwarding/README.md) · [根索引](../../AGENTS.md)

## 架构与文件

转发复用 forward 模式的 SSHSession，通过 `channel.ts` 的 `ForwardChannel` 使用 SSH direct-tcpip 连接远端本地 HTTP 服务。`routes.ts` 分派主站管理与标准转发路由，`state.ts` 在 DO 内存中维护 grant；`http.ts` 处理 HTTP 字节流、请求/响应头及内容改写，`mount.ts` 集中路径/Cookie 挂载规则，`runtime.ts` 生成浏览器路径适配脚本，`body.ts` 有界读取请求体，`errors.ts` 将 SSH 转发错误映射为可展示信息。

## 模式与授权

| 模式 | 入口与条件 |
| --- | --- |
| trusted | 主站 `/_forward/<session>/`；先管理员认证，创建时须显式 `trusted: true` |
| isolated | 独立 preview Worker；跨 site HTTPS Origin，通过 fragment 一次性 launch token 兑换 HttpOnly Cookie |

两种模式不可混用 grant。DO 的账户/Origin/模式核对与预览能力校验各有边界；主 Worker 覆盖内部路由头，preview Worker 剥离浏览器伪造的账户/预览头。preview 域名要求与主站不共享父域 Cookie；同账户双 workers.dev 不提供所需跨 site 隔离。

授权有效期为 1 小时，launch 票据 60 秒；前端离开后会话保留期限为 8 分钟，最终有效期还受保留限制。DO 重启、SSH 断线、显式停止使能力失效。退出登录或工作区认证版本变化后，DO 拒绝旧预览 Cookie 和 launch 能力；活动流按 SSH 会话的十秒周期检查关闭，不保留八分钟。创建 grant 前实际打开 direct-tcpip 探测端口，失败不得返回虚假的可用链接。

## 协议与改写限制

- 只支持 HTTP，不支持 WebSocket Upgrade、CONNECT 或 HTTPS 上游；不得将它宣传为通用反向代理。
- HTTP framing 支持 Content-Length、chunked 与 EOF，拒绝歧义/截断输入；响应取消要关闭对应 SSH channel。
- 请求上传上限 16 MiB、头部上限 64 KiB，与 SFTP 限制不同。
- trusted 的子路径、HTML/CSS/srcset、重定向与 runtime fetch/XHR 改写使用统一 mount 规则；Cookie 需隔离前缀与路径，不能泄漏主站 Cookie、preview 能力或内部头给上游。
- 保留目标 CSP 与额外限制，禁止 Service Worker；标准模式与主站共享 Origin，仅适合用户信任的站点，独立 preview 也不是不同上游之间的多租户隔离。
- `ForwardingError` 保留有意义的 SSH 原因代码；任意上游描述/内部异常不能直接暴露给用户。

## 验证定位

Node 测试为 `tests/forwarding-{auth,http,protocol,routes,mounted,failure}.test.ts`，规则持久化为 `tests/forward-rules.test.ts`；浏览器测试为 forwarding/forwarding-runtime。部署 Origin 条件还需检查 [scripts](../../scripts/README.md) 与 preview 配置。
