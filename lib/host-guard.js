/**
 * 宿主路由的最小同源守卫（模板：复制进插件，不要跨包 import）。
 *
 * 为什么需要：DSH 的 webServer 不校验会话/来源，插件路由默认对「任何网页的跨站请求」
 * 与「DNS rebinding」都敞开。这个模块只做两件事：
 *   1. Host 必须是回环地址 —— 挡住 rebinding（攻击者域解析到 127.0.0.1 后 Host 仍是攻击者域）；
 *   2. Origin 若存在必须等于宿主自身来源 —— 挡住任意网页的跨站 POST。
 *
 * 用法（在 handler 最前面）：
 *   const deny = guardRequest(req, ctx.webServer.getOrigin?.())
 *   if (deny) return sendJson(res, deny.status, deny.body)
 *
 * 注意：
 *   - 隧道代理（dsh-mobile-control）会把 Host/Origin 重写成上游地址，所以手机端不受影响；
 *   - 无 Host 的请求直接拒绝：HTTP/1.1 必需 Host，缺了只能是手工构造的客户端；
 *   - 非浏览器客户端（curl/脚本）不带 Origin，属于「本机可信」，放行。
 */

export function isLoopbackHost(hostHeader) {
  if (!hostHeader) return false
  const host = String(hostHeader).trim().toLowerCase()
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.replace(/:\d+$/, '')
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || name === '::1'
}

export function isSameOrigin(originHeader, selfOrigin) {
  const origin = String(originHeader || '').trim()
  if (!origin) return true
  if (origin === 'null') return false // file:// 或 sandbox iframe
  if (!selfOrigin) return false
  return origin.toLowerCase() === selfOrigin.toLowerCase()
}

/**
 * @returns {{status:number, body:object}|null} 非空表示应直接返回该响应
 */
export function guardRequest(req, selfOrigin) {
  if (!isLoopbackHost(req.headers?.host)) return { status: 403, body: { error: 'forbidden-host' } }
  if (!isSameOrigin(req.headers?.origin, selfOrigin)) return { status: 403, body: { error: 'forbidden-origin' } }
  return null
}
