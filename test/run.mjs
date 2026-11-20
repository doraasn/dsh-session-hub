/**
 * 宿主侧自测：用假服务跑通模型工具与能力开关。
 * 不联网、不碰真实 ~/.dsh（DSH_HOME 指向临时目录）。
 *
 * 用法: npm test
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-session-hub-test.'))
process.env.DSH_HOME = HOME

const { apply } = await import(new URL('../lib/index.js', import.meta.url).href)

/** 记录所有服务调用，断言工具真的落到了对应服务。 */
const calls = []
const agents = [{ id: 'session-1' }, { id: 'session-3' }]
const goalsBySession = new Map([
  ['session-1', {
    id: 'goal-1',
    revision: 2,
    objective: '把会话管理能力收进工具',
    phase: 'active',
    roundsStarted: 1,
    maxGoalRounds: 20,
    activation: 'disarmed',
    createdAt: 1000,
    updatedAt: 2000,
  }],
  ['session-3', {
    id: 'goal-3',
    revision: 5,
    objective: '已经完成的目标',
    phase: 'complete',
    roundsStarted: 5,
    maxGoalRounds: 5,
    activation: 'disarmed',
    createdAt: 1000,
    updatedAt: 2000,
  }],
])

const services = {
  sessionController: {
    async list() {
      return {
        items: [
          {
            sessionId: 'session-1',
            updatedAt: 3000,
            running: false,
            blank: false,
            cwd: 'C:\\Projects\\Alpha',
            projections: { values: { title: 'Alpha 会话' } },
          },
          {
            sessionId: 'session-2',
            updatedAt: 2500,
            running: false,
            blank: false,
            cwd: 'C:\\Projects\\Beta',
          },
          {
            sessionId: 'session-3',
            updatedAt: 2000,
            running: true,
            blank: false,
            cwd: 'C:\\Projects\\Alpha',
          },
          {
            sessionId: 'session-sub',
            updatedAt: 1000,
            running: false,
            blank: false,
            cwd: 'C:\\Projects\\Alpha',
            origin: 'subagent',
          },
        ],
      }
    },
    async create(request) {
      calls.push(['create', request])
      return { sessionId: 'session-new' }
    },
    async rename(request) {
      calls.push(['rename', request])
      return { title: request.title }
    },
    async prompt(request) {
      calls.push(['prompt', request])
      return { accepted: true }
    },
    cancel(request) {
      calls.push(['cancel', request])
      return { accepted: true }
    },
    async fork(request) {
      calls.push(['fork', request])
      return { sessionId: 'session-forked' }
    },
    async resolveAgent(sessionId) {
      if (sessionId === 'session-missing') return { error: { code: 'session/not-found', message: 'missing' } }
      return { agent: { id: sessionId } }
    },
  },
  sessionQuery: {
    async readTitleSnapshots(ids) {
      return ids.map((sessionId) => ({
        sessionId,
        status: 'fulfilled',
        value: { title: { title: sessionId === 'session-2' ? 'Beta 会话' : '按需标题' } },
      }))
    },
    async readSession() {
      return {
        events: [
          { type: 'user/message', time: 1, data: { message: { content: [{ type: 'text', text: '第一条' }] } } },
          { type: 'user/message', time: 2, data: { message: { content: [{ type: 'text', text: '第二条' }] } } },
          { type: 'user/message', time: 3, data: { message: { content: [{ type: 'text', text: '第三条' }] } } },
          { type: 'user/message', time: 4, data: { message: { content: [{ type: 'text', text: '第四条' }] } } },
          { type: 'assistant/message', time: 5, data: { message: { content: [{ type: 'text', text: '第五条' }] } } },
          { type: 'assistant/message', time: 6, data: { message: { content: [{ type: 'text', text: '第六条' }] } } },
        ],
      }
    },
  },
  workspaceRegistry: {
    list() {
      return [
        { id: 'ws-a', title: '项目 A', path: 'C:\\Projects\\Alpha' },
        { id: 'ws-b', title: '项目 B', path: 'C:\\Projects\\Beta' },
      ]
    },
    async archiveSession(sessionId, options) {
      calls.push(['archiveSession', { sessionId, ...options }])
    },
    async unarchiveSession(sessionId) {
      calls.push(['unarchiveSession', { sessionId }])
    },
    async pinSession(sessionId) {
      calls.push(['pinSession', { sessionId }])
    },
    async unpinSession(sessionId) {
      calls.push(['unpinSession', { sessionId }])
    },
  },
  workspaceController: {
    async *follow() {
      yield {
        type: 'baseline',
        value: { archivedSessionIds: ['session-2'], pinnedSessionIds: [] },
      }
    },
  },
  agents: {
    list: () => agents,
    get: (id) => agents.find((agent) => agent.id === id),
  },
  goals: {
    get: (agent) => goalsBySession.get(agent.id),
    create(agent, request) {
      calls.push(['goalCreate', { agent: agent.id, request }])
      return {
        id: 'goal-2',
        revision: 1,
        objective: request.objective,
        phase: 'active',
        roundsStarted: 0,
        maxGoalRounds: request.maxGoalRounds ?? 10,
        activation: 'armed',
        createdAt: 1,
        updatedAt: 1,
      }
    },
    edit(agent, ref, request) {
      calls.push(['goalEdit', { ref, request }])
      return { ...goalsBySession.get(agent.id), ...request, revision: ref.revision + 1 }
    },
    pause(agent, ref) {
      calls.push(['goalPause', ref])
      return { ...goalsBySession.get(agent.id), phase: 'paused', revision: ref.revision + 1 }
    },
    resume(agent, ref) {
      calls.push(['goalResume', ref])
      const base = goalsBySession.get(agent.id)
      return { ...(base ?? { id: ref.id, objective: 'x' }), phase: 'active', activation: 'armed', revision: ref.revision + 1 }
    },
    complete(agent, ref) {
      calls.push(['goalComplete', ref])
      return { ...goalsBySession.get(agent.id), phase: 'complete', revision: ref.revision + 1 }
    },
    clear(agent, ref) {
      calls.push(['goalClear', ref])
      return { id: ref.id, revision: ref.revision + 1 }
    },
  },
  logger: { warn() {} },
}

/** 捕获插件注册的模型工具。 */
const registeredTools = new Map()
services.tools = {
  register(definition) {
    registeredTools.set(definition.name, definition)
    return () => registeredTools.delete(definition.name)
  },
}

let handler = null
const ctx = {
  webServer: {
    register(route) {
      handler = route.handler
    },
    getOrigin: () => 'http://127.0.0.1:55482',
  },
  effect(fn) {
    return fn()
  },
  get(key) {
    return services[key]
  },
}
apply(ctx)

/** 造一个假请求，收集 JSON 响应。 */
const call = (url, options = {}) => new Promise((resolve, reject) => {
  const method = options.method ?? 'GET'
  const listeners = {}
  const req = {
    url,
    method,
    headers: {
      host: options.host ?? '127.0.0.1:55482',
      origin: options.origin ?? 'http://127.0.0.1:55482',
      ...(method === 'POST' && options.csrf !== false ? { 'x-session-hub': '1' } : {}),
      ...(options.headers ?? {}),
    },
    on(event, cb) {
      listeners[event] = cb
    },
    setEncoding() {},
    destroy() {},
  }
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      res.headers[name] = value
    },
    end(text) {
      try {
        resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null })
      } catch (error) {
        reject(error)
      }
    },
  }
  handler(req, res).catch(reject)
  if (method === 'POST') {
    const payload = options.body === undefined ? '' : JSON.stringify(options.body)
    listeners.data?.(Buffer.from(payload))
  }
  listeners.end?.()
})

let passed = 0
let failed = 0
const check = (name, condition, extra = '') => {
  if (condition) passed += 1
  else {
    failed += 1
    console.log(`  FAIL  ${name}${extra ? '  ' + extra : ''}`)
  }
}
const post = (path, body, extra = {}) => call(path, { method: 'POST', body, ...extra })

// 等 follow 第一帧落地
await new Promise((resolve) => setTimeout(resolve, 50))

/* ── 设置接口 ──────────────────────────────────────────────────────────── */
const caps = await call('/dsh-session-hub/api/capabilities')
check('能力接口 200', caps.status === 200)
check('默认全部开启', Object.values(caps.body.capabilities).every(Boolean), JSON.stringify(caps.body.capabilities))
check('返回能力说明表', caps.body.table?.messaging?.tool === 'session_hub_message')

const disable = await post('/dsh-session-hub/api/capabilities', { messaging: false })
check('关闭跨会话消息', disable.status === 200 && disable.body.capabilities.messaging === false)
check('开关已落盘', JSON.parse(fs.readFileSync(path.join(HOME, 'storages', 'session-hub.json'), 'utf8')).messaging === false)
const capsAfter = await call('/dsh-session-hub/api/capabilities')
check('再次读取保持关闭', capsAfter.body.capabilities.messaging === false)

const messageTool = registeredTools.get('session_hub_message')
const disabledCall = await messageTool.execute({ sessionId: 'session-2', message: 'x' }, { agent: { id: 'session-caller' } }).catch((error) => error)
check('关闭后消息工具被拒绝', disabledCall?.code === 'capability-disabled', disabledCall?.message || '')
const enable = await post('/dsh-session-hub/api/capabilities', { messaging: true })
check('重新开启跨会话消息', enable.status === 200 && enable.body.capabilities.messaging === true)

const noCsrf = await post('/dsh-session-hub/api/capabilities', { messaging: false }, { csrf: false })
check('缺少 CSRF 头被拒', noCsrf.status === 403 && noCsrf.body.error?.code === 'missing-csrf-header')
const badHost = await call('/dsh-session-hub/api/capabilities', { host: 'evil.example' })
check('非回环 Host 被拒', badHost.status === 403)
const badOrigin = await call('/dsh-session-hub/api/capabilities', { origin: 'https://evil.example' })
check('跨站 Origin 被拒', badOrigin.status === 403)
const badCap = await post('/dsh-session-hub/api/capabilities', { nope: true })
check('未知开关被拒', badCap.status === 400 && badCap.body.error?.code === 'bad-capability')
const badType = await post('/dsh-session-hub/api/capabilities', { messaging: 'yes' })
check('非布尔开关被拒', badType.status === 400 && badType.body.error?.code === 'bad-capability')
const oldRoute = await call('/dsh-session-hub/api/state')
check('旧会话数据路由已移除', oldRoute.status === 404)

/* ── 工具注册 ──────────────────────────────────────────────────────────── */
check('注册 5 个模型工具', registeredTools.size === 5, JSON.stringify([...registeredTools.keys()]))

/* ── 列表与预览 ────────────────────────────────────────────────────────── */
const listTool = registeredTools.get('session_hub_list')
const listed = await listTool.execute({ limit: 2 })
check('列表按上限返回', listed.sessions.length === 2 && listed.sessions[0].sessionId === 'session-1')
check('归档集合来自 follow', (await listTool.execute({ includeArchived: true })).sessions.find((item) => item.sessionId === 'session-2')?.archived === true)
check('默认隐藏子会话', (await listTool.execute({})).sessions.every((item) => item.sessionId !== 'session-sub'))
check('可选包含子会话', (await listTool.execute({ includeSubagents: true })).sessions.some((item) => item.sessionId === 'session-sub'))
check('项目名来自工作区', listed.sessions[0].project === '项目 A')

const previewTool = registeredTools.get('session_hub_preview')
const preview = await previewTool.execute({ sessionId: 'session-1', limit: 2 })
check('预览只返回最近 N 条', preview.messages.length === 2 && preview.messages[1].text === '第六条')

/* ── 跨会话消息 ────────────────────────────────────────────────────────── */
const toolMessage = await messageTool.execute({ sessionId: 'session-2', message: '工具通道测试' }, { agent: { id: 'session-caller' } })
check('消息工具返回来源', toolMessage.accepted === true && toolMessage.from === 'session-caller')
const toolPrompt = calls.filter(([name]) => name === 'prompt').at(-1)
check('消息工具加来源前缀', toolPrompt?.[1]?.content?.[0]?.text.includes('[跨会话消息 来自 session-caller]') === true)
const selfMessage = await messageTool.execute({ sessionId: 'session-caller', message: 'x' }, { agent: { id: 'session-caller' } }).catch((error) => error)
check('消息工具拒绝发给自己', selfMessage?.code === 'self-send')

/* ── 会话管理 ──────────────────────────────────────────────────────────── */
const sessionTool = registeredTools.get('session_hub_session')
const toolCreate = await sessionTool.execute({ action: 'create', cwd: 'C:\\Projects\\Alpha', title: '工具建会话' })
check('新建并命名', toolCreate.sessionId === 'session-new' && toolCreate.title === '工具建会话')
const toolRename = await sessionTool.execute({ action: 'rename', sessionId: 'session-1', title: '工具改名' })
check('更名', toolRename.title === '工具改名')
const toolPin = await sessionTool.execute({ action: 'pin', sessionId: 'session-2' })
check('置顶', toolPin.pinned === true)
const toolArchive = await sessionTool.execute({ action: 'archive', sessionId: 'session-1', stopActivity: true })
check('归档带 stopActivity', toolArchive.archived === true && calls.some(([name, payload]) => name === 'archiveSession' && payload.stopActivity === true))
const toolCancel = await sessionTool.execute({ action: 'cancel', sessionId: 'session-3' })
check('停止当前轮', toolCancel.accepted === true)
const toolFork = await sessionTool.execute({ action: 'fork', sessionId: 'session-1' })
check('复制会话', toolFork.sessionId === 'session-forked' && toolFork.forkedFrom === 'session-1')

/* ── 目标 ──────────────────────────────────────────────────────────────── */
const goalTool = registeredTools.get('session_hub_goal')
const goalRead = await goalTool.execute({ sessionId: 'session-1', action: 'get' })
check('读取当前目标', goalRead.goal?.phase === 'active' && goalRead.live === true)

const promptCountBefore = calls.filter(([name]) => name === 'prompt').length
const goalCreate = await goalTool.execute({ sessionId: 'session-1', action: 'create', objective: '工具建目标', start: false })
check('新建目标不启动', goalCreate.goal?.id === 'goal-2' && goalCreate.started === false)
check('新建目标不产生消息', calls.filter(([name]) => name === 'prompt').length === promptCountBefore)

const createAndStart = await goalTool.execute({ sessionId: 'session-1', action: 'create', objective: '工具建目标并启动', start: true })
check('新建并启动走 resume', createAndStart.started === true && calls.some(([name]) => name === 'goalResume'))
check('启动不合成人类消息', calls.filter(([name]) => name === 'prompt').length === promptCountBefore)

const startActive = await goalTool.execute({ sessionId: 'session-1', action: 'start', revision: 2 })
check('active 目标也真正 resume', startActive.started === true && calls.filter(([name]) => name === 'goalResume').length >= 2)
check('start 全程没有 prompt', calls.filter(([name]) => name === 'prompt').length === promptCountBefore)

const pause = await goalTool.execute({ sessionId: 'session-1', action: 'pause', revision: 2 })
check('暂停目标', pause.goal?.phase === 'paused')
const conflict = await goalTool.execute({ sessionId: 'session-1', action: 'pause', revision: 1 }).catch((error) => error)
check('revision 冲突被拒', conflict?.code === 'goal-revision-conflict')
const completeStart = await goalTool.execute({ sessionId: 'session-3', action: 'start' }).catch((error) => error)
check('已完成目标不能启动', completeStart?.code === 'goal-complete' && completeStart?.status === 409)

const missingAgent = await goalTool.execute({ sessionId: 'session-missing', action: 'get' })
check('冷会话读取返回 live=false', missingAgent.live === false)

const clear = await goalTool.execute({ sessionId: 'session-1', action: 'clear', revision: 2 })
check('清除目标', clear.cleared === true && clear.goal === null)

console.log(`\n结果: ${passed} 通过 / ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
