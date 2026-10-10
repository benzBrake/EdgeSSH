# DO 与 SSH 会话协调

导航：[README.md](../../src/backend/README.md) · [根索引](../../AGENTS.md)

## 职责与关键文件

`durable-object.ts` 的 `SSHSessionDO` 管理一次性票据、账户归属、主/辅助 WebSocket、TCP 连接、期限和清理。它通过 `cloudflare:sockets` 连接经验证的目标；`session.ts` 的 `SSHSession` 协调协议、认证、Shell、SFTP、监控与 forward 模式，不负责主站 Cookie 登录。

`sftp-handler.ts` 在浏览器 JSON/二进制消息与 `SFTPClient` 间桥接。`security.ts` 提供票据 HMAC 与公网目标检查；`system-info.ts` 定义系统探测命令及解析器，`top-parser.ts` 解析监控输出，`process-framing.ts` 保留跨包边界的尾部标记。

## 内部接口与生命周期

- DO 内部路由为 `/ticket`、`/connect`、`/sftp`、`/processes`、`/forward`、`/forward-http`、`/preview-launch`、`/preview-http`；对外路由由主/预览 Worker 控制，不能直接映射为匿名 HTTP 接口。
- 会话阶段为 version → kex → host-confirm（如需）→ auth → pty → shell → ready → closed；forward 模式通过 `isForwardReady`/`openForward` 提供 direct-tcpip 通道。
- Host Key 签名与指纹确认发生在发送 SSH 凭据之前。`SSHAuthDefectError` 表示凭据或信任的确定性失败，通知前端 `retryable: false`，并以 4001 关闭；不要把这类失败改成自动重试。
- SFTP/进程 attachment token 分别绑定主 WebSocket，在主 SSH 会话存活期间可重复使用，支持辅助通道断线重连；主会话清理时 token 失效，并清理辅助通道、pending open、定时器与 TCP Socket。
- DO 重建后无法从内存恢复活动 SSH 对象，已有连接显式关闭并要求重连。存储中的票据与 account-id 不等于持久化了 SSH 会话。

## 安全与边界

票据有效期 60 秒，有 HMAC 签名与 DO 一次性消费；当前实现保留 IP 字段供审计，**不执行严格 IP 相等校验**，避免多节点反代回源误伤。公网 DNS 解析与地址检查在建立 TCP 连接前执行，Socket 使用校验后的地址，不能只检查输入域名字符串。

SFTP v3 文件传输上限 64 MiB，块大小 64 KiB，路径/目录项/响应体均有边界。清理需防止重复关闭与迟到连接结果复活。SSH rekey 当前显式不支持，不能把初始握手成功当作长连接重新密钥交换已支持。

## 依赖与验证

协议层见 [ssh](../../src/ssh/README.md)，forward 授权与 HTTP 桥接见 [forwarding](../../src/forwarding/README.md)。对应 `tests/ssh-session-failure.test.ts`、`forwarding-failure.test.ts`、`system-info.test.ts`、`auth.test.ts`，浏览器侧有 ssh-failure/files/forwarding 回归。现有测试用内存 bundle 与 socket mock 验证真实类，不要求真实 Cloudflare 连接。
