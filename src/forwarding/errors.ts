/** 只返回受控提示，不把 SSH 服务端的任意描述或内部异常直接暴露给网页。 */
export class ForwardingError extends Error {
  readonly reasonCode?: number;

  constructor(message: string, reasonCode?: number) {
    super(message);
    this.name = 'ForwardingError';
    this.reasonCode = reasonCode;
  }
}

export function forwardingOpenError(reasonCode: number, description: string): ForwardingError {
  let message: string;
  switch (reasonCode) {
    case 1:
      message = 'SSH 服务端禁止此端口转发，请检查 AllowTcpForwarding、DisableForwarding、PermitOpen 及登录密钥的转发限制。';
      break;
    case 2:
      message = /connection refused/i.test(description)
        ? '远端服务拒绝连接，请确认服务已启动并监听该服务器的 IPv4 回环地址，容器服务需将端口发布到宿主机。'
        : 'SSH 服务端无法连接远端端口，请检查服务监听地址、端口和服务器本机防火墙。';
      break;
    case 3:
      message = 'SSH 服务端不支持 direct-tcpip 转发通道。';
      break;
    case 4:
      message = 'SSH 服务端资源不足，无法创建转发通道。';
      break;
    default:
      message = 'SSH 服务端拒绝创建转发通道。';
  }
  return new ForwardingError(`${message}（SSH 原因码 ${reasonCode}）`, reasonCode);
}

export function forwardingErrorMessage(error: unknown, port: number): string {
  const message = error instanceof ForwardingError ? error.message
    : '无法访问远端服务，请检查服务状态和 SSH 转发权限。';
  return `转发到远端 127.0.0.1:${port} 失败：${message}`;
}
