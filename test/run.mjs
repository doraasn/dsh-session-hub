/**
 * 宿主侧自测：用假服务把每条路由跑一遍，断言状态码与返回结构。
 * 不联网、不碰真实 ~/.dsh，也不需要 DSH 进程。
 *
 * 用法: npm test
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-session-hub-test.'))
process.env.DSH_HOME = HOME

const { apply } = await import(new URL('../lib/index.js', import.meta.url).href)

/** 记录所有写动作，断言路由真的调到了对应服务。 */
const calls = []
const agents = [{ id: 'session-1' }, { id: 'session-3' }]
const goalsBySession = new Map([
  ['session-1', {
    id: 'goal-1',
    revision: 2,
    objective: '把会话管理插件做完',
    phase: 'active',
    roundsStarted: 1,
    maxGoalRounds: 20,
    activation: 'armed',
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
            agentAvailable: true,
            cwd: 'C:\\Projects\\Alpha',
            projections: { values: { title: 'Alpha 会话' } },
          },
          {
            sessionId: 'session-2',
            updatedAt: 2500,
            running: false,
            blank: false,
            agentAvailable: true,
            cwd: 'C:\\Projects\\Beta',
          },
          {
            sessionId: 'session-3',
            updatedAt: 2000,
            running: true,
            blank: false,
            agentAvailable: true,
            cwd: 'C:\\Projects\\Alpha',
          },
          {
            sessionId: 'session-sub',
            updatedAt: 1000,
            running: false,
            blank: false,
            agentAvailable: true,
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
          { type: 'user/message', time: 1, data: { message: { content: [{ type: 'text', text: '你好' }] } } },
          { type: 'assistant/message', time: 2, data: { message: { content: [{ type: 'text', text: '在的' }] } } },
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
      if (sessionId === 'session-3' && options?.stopActivity !== true) {
        throw new Error('session-3 is active; retry with stopActivity')
      }
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
      return { ...goalsBySession.get(agent.id), phase: 'active', revision: ref.revision + 1 }
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

/** 捕获插件注册的模型工具，验证它们也是薄封装。 */
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
const post = (url, body, extra = {}) => call(url, { method: 'POST', body, ...extra })

// 等 follow 的第一帧落地
await new Promise((resolve) => setTimeout(resolve, 50))

const state = await call('/session-hub/api/state')
const sessionList = state.body.sessions ?? []
check('状态接口 200', state.status === 200)
check('默认隐藏子会话', sessionList.every((item) => item.id !== 'session-sub'), JSON.stringify(sessionList.map((item) => item.id)))
check('标题 hint 优先', sessionList.find((item) => item.id === 'session-1')?.title === 'Alpha 会话')
check('冷会话标题批量读取', sessionList.find((item) => item.id === 'session-2')?.title === 'Beta 会话')
check('项目名来自工作区', sessionList.find((item) => item.id === 'session-1')?.project === '项目 A')
check('归档集合来自 follow', sessionList.find((item) => item.id === 'session-2')?.archived === true)
check('在线目标随列表返回', sessionList.find((item) => item.id === 'session-1')?.goal?.objective === '把会话管理插件做完')
check('计数正确', state.body.counts.total === 3 && state.body.counts.archived === 1, JSON.stringify(state.body.counts))

const withSub = await call('/session-hub/api/state?includeSubagents=1&force=1')
check('可选包含子会话', withSub.body.sessions.some((item) => item.id === 'session-sub'))

const preview = await call('/session-hub/api/preview?session=session-1')
check('预览返回最近对话', preview.body.messages?.length === 2 && preview.body.messages[1].role === 'assistant')

const goal = await call('/session-hub/api/goal?session=session-1')
check('目标查询返回当前目标', goal.body.goal?.phase === 'active' && goal.body.live === true)

const rename = await post('/session-hub/api/session/rename', { sessionId: 'session-1', title: '新名字' })
check('更名成功', rename.status === 200 && rename.body.title === '新名字')
check('更名调用服务', calls.some(([name, payload]) => name === 'rename' && payload.title === '新名字'))

const message = await post('/session-hub/api/session/message', { sessionId: 'session-2', message: '来对齐一下', mode: 'queue', clientTimeZone: 'Asia/Shanghai' })
check('跨项目发消息成功', message.status === 200 && message.body.accepted === true)
const promptCall = calls.find(([name]) => name === 'prompt')
check('消息走 prompt 且带时区', promptCall?.[1]?.content?.[0]?.text === '来对齐一下' && promptCall?.[1]?.clientTimeZone === 'Asia/Shanghai')

const activeArchive = await post('/session-hub/api/session/archive', { sessionId: 'session-3', archived: true })
check('运行中归档返回 409', activeArchive.status === 409 && activeArchive.body.error?.code === 'session-active')
const forcedArchive = await post('/session-hub/api/session/archive', { sessionId: 'session-3', archived: true, stopActivity: true })
check('确认后归档成功', forcedArchive.status === 200 && forcedArchive.body.archived === true)

const unarchive = await post('/session-hub/api/session/archive', { sessionId: 'session-2', archived: false })
check('取消归档成功', unarchive.status === 200 && unarchive.body.archived === false)

const pin = await post('/session-hub/api/session/pin', { sessionId: 'session-1', pinned: true })
check('置顶成功', pin.status === 200 && pin.body.pinned === true)

const created = await post('/session-hub/api/session/create', { cwd: 'C:\\Projects\\Alpha', title: '新建会话' })
check('新建会话并命名', created.status === 200 && created.body.sessionId === 'session-new' && created.body.title === '新建会话')

const createGoal = await post('/session-hub/api/goal/action', {
  sessionId: 'session-3',
  action: 'create',
  objective: '梳理会话通信方案',
  maxGoalRounds: 8,
  start: true,
})
check('给别的会话建目标并启动', createGoal.status === 200 && createGoal.body.goal?.id === 'goal-2' && createGoal.body.started === true)
check('启动目标会发一轮消息', calls.some(([name, payload]) => name === 'prompt' && payload.sessionId === 'session-3' && payload.content[0].text.includes('开始执行当前目标')))

const pause = await post('/session-hub/api/goal/action', { sessionId: 'session-1', action: 'pause', revision: 2 })
check('暂停目标', pause.status === 200 && pause.body.goal?.phase === 'paused')
const conflict = await post('/session-hub/api/goal/action', { sessionId: 'session-1', action: 'pause', revision: 1 })
check('revision 冲突被拒', conflict.status === 409 && conflict.body.error?.code === 'goal-revision-conflict')

const missingGoal = await post('/session-hub/api/goal/action', { sessionId: 'session-3', action: 'pause' })
check('无目标时报 404', missingGoal.status === 404 && missingGoal.body.error?.code === 'no-goal')

const cancel = await post('/session-hub/api/session/cancel', { sessionId: 'session-3' })
check('停止当前轮', cancel.status === 200 && cancel.body.accepted === true)
const fork = await post('/session-hub/api/session/fork', { sessionId: 'session-1' })
check('复制会话', fork.status === 200 && fork.body.sessionId === 'session-forked')

const noCsrf = await post('/session-hub/api/session/rename', { sessionId: 'session-1', title: 'x' }, { csrf: false })
check('缺少 CSRF 头被拒', noCsrf.status === 403 && noCsrf.body.error?.code === 'missing-csrf-header')
const badHost = await call('/session-hub/api/state', { host: 'evil.example' })
check('非回环 Host 被拒', badHost.status === 403)
const badOrigin = await call('/session-hub/api/state', { origin: 'https://evil.example' })
check('跨站 Origin 被拒', badOrigin.status === 403)
const badMessage = await post('/session-hub/api/session/message', { sessionId: 'session-1', message: '' })
check('空消息被拒', badMessage.status === 400 && badMessage.body.error?.code === 'bad-message')
const missingAgent = await post('/session-hub/api/goal/action', { sessionId: 'session-missing', action: 'create', objective: 'x' })
check('无法唤醒会话时 409', missingAgent.status === 409 && missingAgent.body.error?.code === 'session-unavailable')

// 模型侧工具：注册齐、跨项目消息带来源、目标/会话动作复用同一套服务
check('注册 4 个模型工具', registeredTools.size === 4, JSON.stringify([...registeredTools.keys()]))
const listTool = registeredTools.get('session_hub_list')
const listed = await listTool.execute({ limit: 2 })
check('列表工具按上限返回', listed.sessions.length === 2 && listed.sessions[0].sessionId === 'session-1')

const messageTool = registeredTools.get('session_hub_message')
const toolMessage = await messageTool.execute({ sessionId: 'session-2', message: '工具通道测试' }, { agent: { id: 'session-caller' } })
check('消息工具返回来源', toolMessage.accepted === true && toolMessage.from === 'session-caller')
const toolPrompt = calls.filter(([name]) => name === 'prompt').at(-1)
check('消息工具加来源前缀', toolPrompt?.[1]?.content?.[0]?.text.includes('[跨会话消息 来自 session-caller]') === true)
const selfMessage = await messageTool.execute({ sessionId: 'session-caller', message: 'x' }, { agent: { id: 'session-caller' } }).catch((error) => error)
check('消息工具拒绝发给自己', selfMessage?.code === 'self-send')

const goalTool = registeredTools.get('session_hub_goal')
const goalRead = await goalTool.execute({ sessionId: 'session-1', action: 'get' })
check('目标工具读取当前目标', goalRead.goal?.phase === 'active')
const goalCreate = await goalTool.execute({ sessionId: 'session-3', action: 'create', objective: '工具建目标', start: true })
check('目标工具给别的会话建并启动', goalCreate.goal?.id === 'goal-2' && goalCreate.started === true)

const sessionTool = registeredTools.get('session_hub_session')
const toolCreate = await sessionTool.execute({ action: 'create', cwd: 'C:\\Projects\\Alpha', title: '工具建会话' })
check('会话工具新建并命名', toolCreate.sessionId === 'session-new' && toolCreate.title === '工具建会话')
const toolRename = await sessionTool.execute({ action: 'rename', sessionId: 'session-1', title: '工具改名' })
check('会话工具改名', toolRename.title === '工具改名')
const toolArchive = await sessionTool.execute({ action: 'archive', sessionId: 'session-1', stopActivity: true })
check('会话工具归档', toolArchive.archived === true)
const toolPin = await sessionTool.execute({ action: 'pin', sessionId: 'session-2' })
check('会话工具置顶', toolPin.pinned === true)

console.log(`\n结果: ${passed} 通过 / ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
