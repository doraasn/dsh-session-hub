/**
 * DSH 宿主侧小工具 —— 复制成插件的 `lib/host-kit.js` 后正常 import（宿主侧是 Node ESM，可以多文件）。
 *
 *   import { jsonRoute, createStorage, startPolling, readBody } from './host-kit.js'
 *
 * 约定：只读数据；密钥只在宿主使用、不回传浏览器；状态写 `~/.dsh/storages/<插件>.json`。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const STORAGE_DIR = path.join(os.homedir(), '.dsh', 'storages')

/** 读 JSON 文件，损坏/缺失都退回 fallback（不要让插件因为一个坏文件起不来）。 */
export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** 原子写：先写临时文件再 rename，断电不会留下半个 JSON。 */
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, file)
}

/** 插件自己的状态文件：`~/.dsh/storages/<name>.json`（与 DSH 凭据文件分开）。 */
export function createStorage(name, defaults = {}) {
  const file = path.join(STORAGE_DIR, `${name}.json`)
  return {
    file,
    get() { return { ...defaults, ...(readJson(file, {}) || {}) } },
    set(value) { writeJson(file, value); return value },
    patch(part) { const next = { ...this.get(), ...part }; writeJson(file, next); return next },
  }
}

/** 读请求体（`application/json` 或表单文本），超过 limit 直接截断。 */
export function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) { reject(new Error('body too large')); req.destroy?.(); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * 包一层 JSON 路由：
 *   const route = jsonRoute(async (req, url) => ({ ok: true }))
 *   ctx.webServer.register({ kind: 'prefix', path: '/my-plugin', handler: route })
 * 返回值自动 JSON.stringify；抛错统一 500 + `{ error }`，不会把异常栈发给浏览器。
 */
export function jsonRoute(handler) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      const method = (req.method || 'GET').toUpperCase()
      const body = method === 'POST' || method === 'PUT'
        ? await readBody(req).then((text) => (text ? JSON.parse(text) : null)).catch(() => null)
        : null
      const payload = await handler({ req, url, method, body })
      if (res.writableEnded) return
      res.statusCode = payload?.status ?? 200
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify(payload?.body ?? payload ?? {}))
    } catch (error) {
      if (res.writableEnded) return
      res.statusCode = 500
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: String(error?.message || error) }))
    }
  }
}

/**
 * 轮询：立即跑一次，之后每 intervalMs 一次；单次抛错只记日志，不中断循环。
 * 返回 stop()，记得在 ctx.effect(() => stop) 里清理。
 */
export function startPolling(task, intervalMs, { onError = () => {}, runImmediately = true } = {}) {
  let stopped = false
  let timer = null
  const run = async () => {
    if (stopped) return
    try {
      await task()
    } catch (error) {
      onError(error)
    }
    if (!stopped) timer = setTimeout(run, intervalMs)
  }
  if (runImmediately) run()
  else timer = setTimeout(run, intervalMs)
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}

/**
 * 常量退避：给"外部 CLI 挂了要重拉"这类场景用。
 *   const stop = withBackoff(async () => ensureCli(), { baseMs: 10000, maxMs: 60000 })
 */
export function withBackoff(task, { baseMs = 5000, maxMs = 60000, onError = () => {} } = {}) {
  let attempt = 0
  let stopped = false
  const loop = async () => {
    if (stopped) return
    try {
      await task()
      attempt = 0
    } catch (error) {
      onError(error)
      attempt += 1
    }
    const delay = Math.min(maxMs, baseMs * Math.max(1, 2 ** attempt))
    setTimeout(loop, delay)
  }
  loop()
  return () => { stopped = true }
}
