# SSH 与 SFTP 协议

导航：[README.md](../../src/ssh/README.md) · [根索引](../../AGENTS.md)

## 分层与主要接口

本目录是 Worker 内运行的 SSH 客户端协议实现，输入输出使用 Uint8Array、Web Crypto 和明确的二进制字段；生命周期由 [backend/session.ts](../../src/backend/session.ts) 协调。

| 文件 | 职责 |
| --- | --- |
| `transport.ts` | 客户端 identification、远端 SSH 2.0/1.99 标识 |
| `packet.ts` | `SSHPacketParser`/`SSHPacketBuilder` 与序列号 |
| `algorithms.ts`、`kex.ts` | 支持列表、KEXINIT、算法协商与扩展解析 |
| `kex-curve25519.ts`、`kex-ecdh.ts` | 密钥交换与 exchange hash |
| `keys.ts`、`crypto.ts` | 会话密钥派生、AES-GCM/CTR、HMAC |
| `auth.ts`、`auth-password.ts` | 公钥签名、私钥解析、password 与单密码 keyboard-interactive |
| `host-key.ts` | 已知指纹与首次/变更信任分类 |
| `channel.ts` | `SSHChannel`、数据分块、窗口/通道请求 |
| `sftp.ts`、`sftp-types.ts` | SFTPClient、请求 ID、状态/超时错误、属性与类型 |
| `utils.ts` | 大端整数、string/mpint、BufferSource 与字节拼接 |

## 支持边界

当前 KEX 为 curve25519-sha256、ecdh-sha2-nistp256；加密支持 OpenSSH AES-128/256-GCM 与 AES-128/192/256-CTR，MAC 为 HMAC-SHA2-256/512。公钥认证支持 Ed25519、RSA 与 ECDSA，具体签名选择由 `auth.ts` 与服务器扩展协商控制，不要凭 README 扩大算法支持范围。

`auth.ts` 实现特定加密 OpenSSH 私钥的 `aes256-ctr` + `bcrypt` 解密与口令检查，不能笼统写成“所有加密 PEM 格式均支持”，也不能沿用 README 的“加密私钥暂不支持”。vendored bcrypt 实现在 `../vendor/bcrypt-pbkdf.js`，前端有对应副本。

SFTP 版本为 3；协议解析有包长、名称数量、扩展属性数量与 UTF-8 检查，区分 `SFTPProtocolError`、`SFTPStatusError` 和 `SFTPTimeoutError`。单文件 64 MiB 是 backend/front-end 传输策略，不能与协议层默认包长混为一谈。SSH rekey 在会话层显式拒绝。

## 修改约束

- RFC 编码字段、序列号、exchange hash、签名 blob、密钥派生方向与通道窗口不能以字符串拼接或隐式端序替代。
- Web Crypto 的 ArrayBuffer/BufferSource 类型边界用现有工具处理；保留包长度、尾随字节和整数溢出检查，畸形协议数据必须明确失败。
- 调整算法列表时同步检查协商、CipherSpec/MacSpec、会话状态与测试；不增加静默弱算法回退。
- SFTP 请求取消/超时/关闭需完整清理 pending 状态，分包输入不能假定 TCP 或 SSH chunk 恰好等于一个协议包。

## 验证

相关测试为 `ssh-keygen.test.ts`、`ssh-session-failure.test.ts`、`forwarding-failure.test.ts`、`forwarding-mounted.test.ts`；当前目录没有独立的包入口或专属 test script。类型检查用根 Worker tsconfig。协议改动应沿用测试中的内存 bundle 或 byte fixture，并按任务需要单独验收真实服务器互操作。
