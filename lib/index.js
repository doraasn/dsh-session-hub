/**
 * 宿主侧：会话管理的全部数据与动作都走 DSH 已有服务，不碰会话日志格式、不落自定义状态。
 *
 * 读：
 *   - `sessionController.list` 取可见会话（跨项目）；
 *   - `sessionQuery.readTitleSnapshots` 批量折标题（冷会话也能读）；
 *   - `workspaceRegistry.list` 取项目名；
 *   - `workspaceController.follow` 维护归档/置顶集合；
 *   - `ctx.agents` / `ctx.goals` 读在线会话的当前目标。
 *
 * 写：
 *   - `sessionController.create / rename / prompt / cancel / fork`；
 *   - `workspaceRegistry.archiveSession / unarchiveSession / pinSession / unpinSession`；
 *   - `sessionController.resolveAgent` + `ctx.goals.*`（可在别的会话上建/改/启动目标）。
 *
 * 路由只信任本机回环 + 同源；POST 额外要求 `x-session-hub: 1`，挡住普通跨站表单。
 */
import { randomUUID } from 'node:crypto'

import { guardRequest } from './host-guard.js'
import { readBody } from './host-kit.js'

export const name = 'session-hub'
export const inject = ['webServer']

const PREFIX = '/session-hub'
const API = `${PREFIX}/api`
const STATE_TTL_MS = 3000
const PREVIEW_TTL_MS = 5000
const PREVIEW_LIMIT = 80
const MAX_BODY = 64 * 1024

/** 写一个 JSON 响应；所有路由的唯一出口。 */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** 带 HTTP 状态码的业务错误：路由层统一转成 `{ error: { code, message } }`。 */
class HubError extends Error {
  /**
   * @param {string} code 稳定错误码，Client 据此分支
   * @param {string} message 可直接展示的中文说明
   * @param {number} [status] HTTP 状态码
   */
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

/** 会话 id 只接受普通字符，避免把任意字符串塞进服务层。 */
function sessionIdOf(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(id)) throw new HubError('bad-session-id', '会话 id 不合法')
  return id
}

/** 标题：去掉首尾空白，长度 1..120。 */
function titleOf(value, field = '标题') {
  const title = typeof value === 'string' ? value.trim() : ''
  if (title === '') throw new HubError('bad-title', `${field}不能为空`)
  if (title.length > 120) throw new HubError('bad-title', `${field}最多 120 个字符`)
  return title
}

/** 目标正文：去掉首尾空白，长度 1..4000。 */
function objectiveOf(value) {
  const objective = typeof value === 'string' ? value.trim() : ''
  if (objective === '') throw new HubError('bad-objective', '目标内容不能为空')
  if (objective.length > 4000) throw new HubError('bad-objective', '目标内容最多 4000 个字符')
  return objective
}

/** 消息正文：1..8000 字符。 */
function messageOf(value) {
  const message = typeof value === 'string' ? value.trim() : ''
  if (message === '') throw new HubError('bad-message', '消息不能为空')
  if (message.length > 8000) throw new HubError('bad-message', '消息最多 8000 个字符')
  return message
}

/** 轮次上限：1..1000 的整数；缺省沿用 DSH 默认。 */
function maxRoundsOf(value) {
  if (value === undefined || value === null || value === '') return undefined
  const rounds = Number(value)
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 1000) {
    throw new HubError('bad-rounds', '轮次上限必须是 1..1000 的整数')
  }
  return rounds
}

/** 目录：只做形状检查，真实存在性由 DSH 的 create 自己校验。 */
function pathOf(value) {
  if (value === undefined || value === null || value === '') return undefined
  const path = String(value).trim()
  if (path.length > 1024 || path.includes('\0')) throw new HubError('bad-path', '目录路径不合法')
  return path
}

/** 只接受合法 IANA 时区名；不合法就不传，交给宿主默认。 */
function timeZoneOf(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_+/-]{1,64}$/.test(value)) return undefined
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return value
  } catch {
    return undefined
  }
}

/** 取路径最后一段，作为没有工作区记录时的项目名。 */
function baseName(path) {
  if (typeof path !== 'string' || path === '') return ''
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/** 统一小写、正斜杠，用于 cwd 与工作区 path 的宽松匹配。 */
function pathKey(path) {
  return typeof path === 'string' ? path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : ''
}

/** 从消息内容块里取纯文本。 */
function textOfMessage(message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  const text = blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
  return text
}

/** 目标视图裁剪成 Client 需要的字段。 */
function goalViewOf(goal) {
  if (!goal) return null
  return {
    id: goal.id,
    revision: goal.revision,
    objective: goal.objective,
    phase: goal.phase,
    roundsStarted: goal.roundsStarted,
    maxGoalRounds: goal.maxGoalRounds,
    activation: goal.activation,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
    blockedReason: goal.blockedReason ?? null,
  }
}

/** 启动目标后发给目标会话的指令：既触发一轮，也要求它按目标规则自行更新状态。 */
function startPromptOf(objective) {
  return [
    '请开始执行当前目标，并先对照目标检查已有进度。',
    '',
    `目标：${objective}`,
    '',
    '要求：持续推进直到完成；完成时调用 update_goal 标记 complete，遇到硬性阻塞时标记 blocked 并说明具体条件。',
  ].join('\n')
}

/** 等待 ms，abort 时立即返回。 */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

/**
 * 跟踪工作区的归档/置顶集合。
 *
 * 这个集合只有 follow 流能拿到（工作区服务没有同步读方法）；流断开时保留上一帧，
 * 本插件自己的归档/置顶动作也会就地更新，所以短暂断流不会把状态打回原样。
 *
 * @param {object} ctx 插件上下文
 * @param {{ archived: Set<string>, pinned: Set<string> }} state 共享集合
 * @returns {() => void} 停止函数
 */
function followWorkspaces(ctx, state) {
  const ac = new AbortController()
  void (async () => {
    let delay = 1000
    while (!ac.signal.aborted) {
      const controller = ctx.get('workspaceController')
      if (!controller) {
        await sleep(delay, ac.signal)
        delay = Math.min(delay * 2, 15000)
        continue
      }
      try {
        for await (const frame of controller.follow(ac.signal)) {
          delay = 1000
          if (frame?.type === 'baseline' || frame?.type === 'replace') {
            state.archived = new Set(frame.value?.archivedSessionIds ?? [])
            state.pinned = new Set(frame.value?.pinnedSessionIds ?? [])
          } else if (frame?.type === 'archived') {
            state.archived = new Set(frame.archivedSessionIds ?? [])
          } else if (frame?.type === 'pinned') {
            state.pinned = new Set(frame.pinnedSessionIds ?? [])
          }
        }
      } catch {
        // 流不可用时退化成「本插件记录的状态」，不要让整个面板挂掉。
      }
      if (ac.signal.aborted) break
      await sleep(delay, ac.signal)
      delay = Math.min(delay * 2, 15000)
    }
  })()
  return () => ac.abort()
}

/**
 * 安装会话管理路由。
 *
 * @param {object} ctx DSH 插件上下文（至少含 webServer）
 * @returns {void}
 */
export function apply(ctx) {
  /** follow 维护的持久集合；同时作为本插件动作的即时回写。 */
  const tracked = { archived: new Set(), pinned: new Set() }

  /** 整表缓存：多个页面同时轮询时只跑一次聚合。 */
  let stateCache = { at: 0, value: null }
  /** 单个会话最近消息缓存：预览只在选中时读，5 秒内复用。 */
  const previews = new Map()

  ctx.effect(() => followWorkspaces(ctx, tracked), 'session-hub: workspace follow')

  /** 取服务；缺失时给可读错误。 */
  const requireService = (key) => {
    const service = ctx.get(key)
    if (!service) throw new HubError('service-unavailable', `当前 profile 没有 ${key} 服务`, 503)
    return service
  }

  /** 清缓存：任何写动作后都要让下一次读看到新状态。 */
  const invalidate = () => {
    stateCache = { at: 0, value: null }
  }

  /** 解析或唤醒一个会话，返回可被 goals 使用的在线 Agent。 */
  const resolveAgent = async (sessionId) => {
    const live = ctx.get('agents')?.get(sessionId)
    if (live) return live
    const controller = requireService('sessionController')
    const result = await controller.resolveAgent(sessionId)
    if (result?.error) {
      throw new HubError('session-unavailable', `会话无法唤醒：${result.error.code ?? 'unknown'}`, 409)
    }
    if (!result?.agent) throw new HubError('session-unavailable', '会话无法唤醒', 409)
    return result.agent
  }

  /** 读所有在线会话的目标，按 sessionId 建索引。 */
  const readGoals = () => {
    const goalsService = ctx.get('goals')
    const agents = ctx.get('agents')
    const map = new Map()
    if (!goalsService || !agents) return map
    for (const agent of agents.list()) {
      try {
        const goal = goalsService.get(agent)
        if (goal) map.set(agent.id, goalViewOf(goal))
      } catch {
        // 单个会话读不到目标不影响其它会话
      }
    }
    return map
  }

  /** 批量读标题：优先用列表里的投影 hint，缺的再走会话查询。 */
  const readTitles = async (items, signal) => {
    const titles = new Map()
    const missing = []
    for (const item of items) {
      const hinted = item.projections?.values?.title
      if (typeof hinted === 'string' && hinted.trim() !== '') titles.set(item.sessionId, hinted.trim())
      else missing.push(item.sessionId)
    }
    const query = ctx.get('sessionQuery')
    if (!query || missing.length === 0) return titles
    try {
      const results = await query.readTitleSnapshots(missing, signal)
      for (const result of results) {
        if (result.status !== 'fulfilled') continue
        const title = result.value?.title?.title
        if (typeof title === 'string' && title.trim() !== '') titles.set(result.sessionId, title.trim())
      }
    } catch {
      // 标题只是展示信息；读不到就显示「未命名」，不影响列表
    }
    return titles
  }

  /** 聚合一次完整状态。 */
  const readState = async (options = {}) => {
    const now = Date.now()
    if (!options.force && stateCache.value && now - stateCache.at < STATE_TTL_MS) return stateCache.value

    const controller = requireService('sessionController')
    const signal = AbortSignal.timeout(20000)
    const listed = await controller.list({}, signal)
    const items = Array.isArray(listed?.items) ? listed.items : []
    const includeSubagents = options.includeSubagents === true

    let workspaceList = []
    try {
      workspaceList = ctx.get('workspaceRegistry')?.list?.() ?? []
    } catch {
      workspaceList = []
    }
    const workspaceByPath = new Map()
    for (const workspace of workspaceList) {
      const key = pathKey(workspace.path)
      if (key) workspaceByPath.set(key, { id: workspace.id, title: workspace.title, path: workspace.path })
    }

    const titles = await readTitles(items, signal)
    const goals = readGoals()
    const liveIds = new Set((ctx.get('agents')?.list?.() ?? []).map((agent) => agent.id))

    const sessions = []
    for (const item of items) {
      const id = item.sessionId
      if (!includeSubagents && item.origin === 'subagent') continue
      const workspace = workspaceByPath.get(pathKey(item.cwd))
      sessions.push({
        id,
        title: titles.get(id) ?? '',
        cwd: item.cwd ?? '',
        project: workspace?.title || baseName(item.cwd) || '默认位置',
        workspaceId: workspace?.id ?? null,
        updatedAt: item.updatedAt ?? 0,
        running: item.running === true,
        blank: item.blank === true,
        agentAvailable: item.agentAvailable === true,
        live: liveIds.has(id),
        parentSessionId: item.parentSessionId ?? null,
        origin: item.origin ?? null,
        archived: tracked.archived.has(id),
        pinned: tracked.pinned.has(id),
        goal: goals.get(id) ?? null,
      })
    }

    const value = {
      updatedAt: now,
      sessions,
      workspaces: workspaceList.map((workspace) => ({
        id: workspace.id,
        title: workspace.title,
        path: workspace.path,
      })),
      counts: {
        total: sessions.length,
        running: sessions.filter((session) => session.running).length,
        archived: sessions.filter((session) => session.archived).length,
        goals: sessions.filter((session) => session.goal).length,
      },
    }
    stateCache = { at: now, value }
    return value
  }

  /** 读一个会话最近几条对话，供发消息前确认上下文。 */
  const readPreview = async (sessionId) => {
    const cached = previews.get(sessionId)
    if (cached && Date.now() - cached.at < PREVIEW_TTL_MS) return cached.value
    const query = requireService('sessionQuery')
    const snapshot = await query.readSession(sessionId)
    const events = Array.isArray(snapshot?.events) ? snapshot.events : []
    const messages = []
    for (const event of events) {
      if (event?.type !== 'user/message' && event?.type !== 'assistant/message') continue
      const text = textOfMessage(event.data?.message)
      if (text === '') continue
      messages.push({
        role: event.type === 'user/message' ? 'user' : 'assistant',
        text: text.length > 600 ? `${text.slice(0, 600)}…` : text,
        time: event.time ?? 0,
      })
    }
    const value = { sessionId, messages: messages.slice(-6) }
    previews.set(sessionId, { at: Date.now(), value })
    while (previews.size > PREVIEW_LIMIT) previews.delete(previews.keys().next().value)
    return value
  }

  /** 归档一个会话；运行中的会话先拒绝，由 Client 二次确认后带 stopActivity 重试。 */
  const archiveSession = async (sessionId, archived, stopActivity) => {
    const registry = ctx.get('workspaceRegistry')
    if (archived) {
      if (registry) await registry.archiveSession(sessionId, { stopActivity: stopActivity === true })
      else await requireService('workspaceController').archiveSession({ sessionId, stopActivity: stopActivity === true })
      tracked.archived.add(sessionId)
      tracked.pinned.delete(sessionId)
    } else {
      if (registry) await registry.unarchiveSession(sessionId)
      else await requireService('workspaceController').unarchiveSession({ sessionId })
      tracked.archived.delete(sessionId)
    }
  }

  /** 置顶/取消置顶。 */
  const pinSession = async (sessionId, pinned) => {
    const registry = ctx.get('workspaceRegistry')
    if (pinned) {
      if (registry) await registry.pinSession(sessionId)
      else await requireService('workspaceController').pinSession({ sessionId })
      tracked.pinned.add(sessionId)
    } else {
      if (registry) await registry.unpinSession(sessionId)
      else await requireService('workspaceController').unpinSession({ sessionId })
      tracked.pinned.delete(sessionId)
    }
  }

  /** 给任意会话发一条用户消息；冷会话由 sessionController 自己唤醒。 */
  const sendMessage = async (sessionId, message, mode, clientTimeZone) => {
    const controller = requireService('sessionController')
    const request = {
      requestId: `session-hub-${randomUUID()}`,
      sessionId,
      mode: mode === 'steer' ? 'steer' : 'queue',
      content: [{ type: 'text', text: message }],
    }
    const zone = timeZoneOf(clientTimeZone)
    if (zone) request.clientTimeZone = zone
    const result = await controller.prompt(request, AbortSignal.timeout(30000))
    if (!result?.accepted) throw new HubError('message-rejected', '目标会话没有接收这条消息', 409)
    return { accepted: true }
  }

  /** 读取当前目标；只有在线 Agent 能同步读。 */
  const currentGoal = (sessionId) => {
    const goalsService = ctx.get('goals')
    const agent = ctx.get('agents')?.get(sessionId)
    if (!goalsService || !agent) return null
    return goalViewOf(goalsService.get(agent))
  }

  /** 目标动作统一入口：先在线解析，再落到 goals 服务。 */
  const goalAction = async (payload) => {
    const sessionId = sessionIdOf(payload.sessionId)
    const action = String(payload.action || '')
    const goalsService = requireService('goals')
    const agent = await resolveAgent(sessionId)
    const current = goalsService.get(agent)

    if (action === 'create') {
      const objective = objectiveOf(payload.objective)
      const maxGoalRounds = maxRoundsOf(payload.maxGoalRounds)
      let created
      try {
        created = goalsService.create(agent, maxGoalRounds === undefined ? { objective } : { objective, maxGoalRounds })
      } catch (error) {
        throw new HubError('goal-create-failed', error instanceof Error ? error.message : String(error), 409)
      }
      if (payload.start === true) {
        await sendMessage(sessionId, startPromptOf(created.objective), 'queue', payload.clientTimeZone)
      }
      invalidate()
      return { goal: goalViewOf(created), started: payload.start === true }
    }

    if (!current) throw new HubError('no-goal', '该会话当前没有目标', 404)
    const ref = { id: current.id, revision: current.revision }
    if (payload.revision !== undefined && Number(payload.revision) !== current.revision) {
      throw new HubError('goal-revision-conflict', '目标已被改动，请刷新后重试', 409)
    }

    if (action === 'edit') {
      const request = {}
      if (payload.objective !== undefined) request.objective = objectiveOf(payload.objective)
      const rounds = maxRoundsOf(payload.maxGoalRounds)
      if (rounds !== undefined) request.maxGoalRounds = rounds
      if (Object.keys(request).length === 0) throw new HubError('bad-goal-edit', '没有需要修改的字段')
      const edited = goalsService.edit(agent, ref, request)
      invalidate()
      return { goal: goalViewOf(edited) }
    }

    if (action === 'pause') {
      const paused = goalsService.pause(agent, ref)
      invalidate()
      return { goal: goalViewOf(paused) }
    }

    if (action === 'resume' || action === 'start') {
      const resumed = current.phase === 'paused' ? goalsService.resume(agent, ref) : current
      if (action === 'start') {
        await sendMessage(sessionId, startPromptOf(resumed.objective), 'queue', payload.clientTimeZone)
      }
      invalidate()
      return { goal: goalViewOf(resumed), started: action === 'start' }
    }

    if (action === 'complete') {
      const completed = goalsService.complete(agent, ref)
      invalidate()
      return { goal: goalViewOf(completed) }
    }

    if (action === 'clear') {
      goalsService.clear(agent, ref)
      invalidate()
      return { goal: null, cleared: true }
    }

    if (action === 'refresh') {
      const refreshed = goalsService.get(agent)
      invalidate()
      return { goal: goalViewOf(refreshed) }
    }

    throw new HubError('bad-goal-action', `未知目标动作：${action}`)
  }

  /* ── 模型侧工具：让会话之间也能跨项目通信、互相建/启动目标 ────────────── */

  /** 工具参数里取调用者会话；没有归属 Agent 时直接拒绝。 */
  const requireCaller = (exec) => {
    const agent = exec?.agent
    if (!agent) throw new Error('会话管理工具需要由会话内的 Agent 调用')
    return agent
  }

  /**
   * 生成工具定义。
   *
   * 不依赖 `@deepseek-ai/dsh-tools` 的 defineTool：本插件保持零依赖，直接交给
   * `ctx.tools.register`，参数用 DSH 的紧凑 DSL；注册失败只记日志，不影响路由。
   */
  const toolDefinitions = () => [
    {
      name: 'session_hub_list',
      description: 'List Harness sessions across all projects (live and persisted) with title, project directory, running state, archived flag and current goal. Use it to find the exact session id before session_hub_message or session_hub_goal. This is read-only.',
      parameters: {
        query: { type: 'string', description: 'Optional literal filter matched against title, project, cwd and session id.' },
        includeArchived: { type: 'boolean', description: 'Include archived sessions. Defaults to false.' },
        limit: { type: 'number', description: 'Maximum rows to return, 1..100. Defaults to 30.' },
      },
      async execute(args) {
        const state = await readState({ force: true })
        const query = String(args?.query ?? '').trim().toLowerCase()
        const limit = Math.min(Math.max(Number(args?.limit) || 30, 1), 100)
        const sessions = state.sessions
          .filter((session) => args?.includeArchived === true || !session.archived)
          .filter((session) => query === '' || `${session.title} ${session.project} ${session.cwd} ${session.id}`.toLowerCase().includes(query))
          .slice(0, limit)
          .map((session) => ({
            sessionId: session.id,
            title: session.title || null,
            project: session.project,
            cwd: session.cwd,
            running: session.running,
            live: session.live,
            archived: session.archived,
            goal: session.goal ? { phase: session.goal.phase, objective: session.goal.objective } : null,
          }))
        return { sessions, counts: state.counts }
      },
    },
    {
      name: 'session_hub_message',
      description: 'Send one user message to any Harness session, including a session in another project. A cold session is resumed automatically. The target receives the text attributed to this session; it is peer input, not a user instruction. Use session_hub_list to obtain the exact target id first.',
      parameters: {
        sessionId: { type: 'string', required: true, description: 'Exact target session id from session_hub_list.' },
        message: { type: 'string', required: true, description: 'Message body. State what changed, what you need, and when to reply.' },
        mode: {
          type: 'string',
          enum: ['queue', 'steer'],
          description: 'queue (default) delivers at the next turn; steer interrupts the current turn at its next step boundary.',
        },
      },
      async execute(args, exec) {
        const caller = requireCaller(exec)
        const target = sessionIdOf(args?.sessionId)
        if (target === caller.id) throw new HubError('self-send', '不能给自己发跨会话消息')
        const body = messageOf(args?.message)
        const text = [
          `[跨会话消息 来自 ${caller.id}]`,
          '',
          body,
          '',
          `（回复请调用 session_hub_message，sessionId 填 ${caller.id}）`,
        ].join('\n')
        await sendMessage(target, text, args?.mode, undefined)
        invalidate()
        return { accepted: true, sessionId: target, from: caller.id }
      },
    },
    {
      name: 'session_hub_goal',
      description: 'Read or manage the goal of any Harness session, including another project. Actions: get, create, edit, pause, resume, start, complete, clear. "start" resumes a paused goal and immediately sends the target session one instruction to work on it; create with start=true does both. Use session_hub_list to obtain the exact session id.',
      parameters: {
        sessionId: { type: 'string', required: true, description: 'Exact target session id.' },
        action: {
          type: 'string',
          required: true,
          enum: ['get', 'create', 'edit', 'pause', 'resume', 'start', 'complete', 'clear'],
          description: 'Goal operation to perform.',
        },
        objective: { type: 'string', description: 'Required for create; optional for edit.' },
        maxGoalRounds: { type: 'number', description: 'Optional round cap, 1..1000.' },
        revision: { type: 'number', description: 'Expected current revision for edit/pause/resume/start/complete/clear; a mismatch is refused.' },
        start: { type: 'boolean', description: 'For create only: immediately start the new goal.' },
      },
      async execute(args) {
        const sessionId = sessionIdOf(args?.sessionId)
        const action = String(args?.action ?? '')
        if (action === 'get') {
          return {
            sessionId,
            live: ctx.get('agents')?.get(sessionId) !== undefined,
            goal: currentGoal(sessionId),
          }
        }
        return goalAction({
          sessionId,
          action,
          objective: args?.objective,
          maxGoalRounds: args?.maxGoalRounds,
          revision: args?.revision,
          start: args?.start === true,
        })
      },
    },
    {
      name: 'session_hub_session',
      description: 'Create, rename, archive, unarchive, pin or unpin a Harness session. Archive hides a session from workspace surfaces and can stop its running work; use stopActivity=true only after deciding that stopping is acceptable. Creating a session returns its id, which can then be opened or messaged.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: ['create', 'rename', 'archive', 'unarchive', 'pin', 'unpin'],
          description: 'Session operation to perform.',
        },
        sessionId: { type: 'string', description: 'Target session id; required except for create.' },
        title: { type: 'string', description: 'New title for rename, or optional initial title for create.' },
        cwd: { type: 'string', description: 'Optional absolute working directory for create; omitted uses the default directory.' },
        agentPreset: { type: 'string', description: 'Optional Agent preset id for create.' },
        stopActivity: { type: 'boolean', description: 'For archive: stop running work instead of refusing an active session.' },
      },
      async execute(args) {
        const action = String(args?.action ?? '')
        const controller = requireService('sessionController')
        if (action === 'create') {
          const request = {}
          const cwd = pathOf(args?.cwd)
          if (cwd !== undefined) request.cwd = cwd
          if (typeof args?.agentPreset === 'string' && args.agentPreset.trim() !== '') request.agentPreset = args.agentPreset.trim()
          const created = await controller.create(request)
          if (!created?.sessionId) throw new HubError('session-create-failed', '会话创建失败', 500)
          let title = ''
          if (typeof args?.title === 'string' && args.title.trim() !== '') {
            title = titleOf(args.title)
            await controller.rename({ sessionId: created.sessionId, title })
          }
          invalidate()
          return { sessionId: created.sessionId, title }
        }

        const sessionId = sessionIdOf(args?.sessionId)
        if (action === 'rename') {
          const title = titleOf(args?.title)
          const result = await controller.rename({ sessionId, title })
          invalidate()
          return { sessionId, title: result?.title ?? title }
        }
        if (action === 'archive' || action === 'unarchive') {
          await archiveSession(sessionId, action === 'archive', args?.stopActivity === true)
          invalidate()
          return { sessionId, archived: action === 'archive' }
        }
        if (action === 'pin' || action === 'unpin') {
          await pinSession(sessionId, action === 'pin')
          invalidate()
          return { sessionId, pinned: action === 'pin' }
        }
        throw new HubError('bad-session-action', `未知会话动作：${action}`)
      },
    },
  ]

  /** 注册模型侧工具；任一失败只记日志，保证路由仍可用。 */
  ctx.effect(() => {
    const tools = ctx.get('tools')
    if (!tools || typeof tools.register !== 'function') return () => {}
    const disposers = []
    for (const definition of toolDefinitions()) {
      try {
        const dispose = tools.register(definition)
        if (typeof dispose === 'function') disposers.push(dispose)
      } catch (error) {
        ctx.logger?.warn?.(`session-hub: register tool ${definition.name} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // 卸载顺序由宿主管理，单项失败不影响其它工具
        }
      }
    }
  }, 'session-hub: model tools')

  /** 路由实现：返回 { status, body }。 */
  const route = async (url, method, req, body) => {
    const path = url.pathname

    if (path === `${API}/state` && method === 'GET') {
      return {
        body: await readState({
          force: url.searchParams.get('force') === '1',
          includeSubagents: url.searchParams.get('includeSubagents') === '1',
        }),
      }
    }

    if (path === `${API}/preview` && method === 'GET') {
      const sessionId = sessionIdOf(url.searchParams.get('session'))
      return { body: await readPreview(sessionId) }
    }

    if (path === `${API}/goal` && method === 'GET') {
      const sessionId = sessionIdOf(url.searchParams.get('session'))
      return { body: { goal: currentGoal(sessionId), live: ctx.get('agents')?.get(sessionId) !== undefined } }
    }

    if (method !== 'POST') throw new HubError('method-not-allowed', '不支持的请求方法', 405)

    if (path === `${API}/session/create`) {
      const controller = requireService('sessionController')
      const cwd = pathOf(body?.cwd)
      const request = {}
      if (cwd !== undefined) request.cwd = cwd
      if (typeof body?.agentPreset === 'string' && body.agentPreset.trim() !== '') {
        request.agentPreset = body.agentPreset.trim()
      }
      const created = await controller.create(request)
      const sessionId = created?.sessionId
      if (!sessionId) throw new HubError('session-create-failed', '会话创建失败', 500)
      let title = ''
      if (body?.title !== undefined && String(body.title).trim() !== '') {
        title = titleOf(body.title)
        await controller.rename({ sessionId, title })
      }
      invalidate()
      return { body: { sessionId, title } }
    }

    if (path === `${API}/session/rename`) {
      const sessionId = sessionIdOf(body?.sessionId)
      const title = titleOf(body?.title)
      const controller = requireService('sessionController')
      const result = await controller.rename({ sessionId, title })
      invalidate()
      return { body: { title: result?.title ?? title } }
    }

    if (path === `${API}/session/archive`) {
      const sessionId = sessionIdOf(body?.sessionId)
      const archived = body?.archived !== false
      const stopActivity = body?.stopActivity === true
      try {
        await archiveSession(sessionId, archived, stopActivity)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (archived && /active/i.test(message) && !stopActivity) {
          throw new HubError('session-active', '会话正在运行，归档会先停止当前工作；确认后可重试', 409)
        }
        throw new HubError('archive-failed', message, 409)
      }
      invalidate()
      return { body: { archived } }
    }

    if (path === `${API}/session/pin`) {
      const sessionId = sessionIdOf(body?.sessionId)
      const pinned = body?.pinned === true
      try {
        await pinSession(sessionId, pinned)
      } catch (error) {
        throw new HubError('pin-failed', error instanceof Error ? error.message : String(error), 409)
      }
      invalidate()
      return { body: { pinned } }
    }

    if (path === `${API}/session/message`) {
      const sessionId = sessionIdOf(body?.sessionId)
      const message = messageOf(body?.message)
      await sendMessage(sessionId, message, body?.mode, body?.clientTimeZone)
      invalidate()
      return { body: { accepted: true } }
    }

    if (path === `${API}/session/cancel`) {
      const sessionId = sessionIdOf(body?.sessionId)
      const controller = requireService('sessionController')
      const result = controller.cancel({ sessionId })
      invalidate()
      return { body: { accepted: result?.accepted === true } }
    }

    if (path === `${API}/session/fork`) {
      const sessionId = sessionIdOf(body?.sessionId)
      const controller = requireService('sessionController')
      const forked = await controller.fork({ sessionId })
      if (!forked?.sessionId) throw new HubError('fork-failed', '会话复制失败', 500)
      invalidate()
      return { body: { sessionId: forked.sessionId } }
    }

    if (path === `${API}/goal/action`) {
      return { body: await goalAction(body ?? {}) }
    }

    throw new HubError('not-found', '接口不存在', 404)
  }

  /** 宿主路由入口：守卫 → 方法/CSRF 检查 → 业务 → 统一错误。 */
  const handler = async (req, res) => {
    const selfOrigin = (() => {
      try {
        return new URL(ctx.webServer.getOrigin?.() ?? '').origin
      } catch {
        return ''
      }
    })()
    const denied = guardRequest(req, selfOrigin)
    if (denied) return sendJson(res, denied.status, denied.body)

    const url = new URL(req.url || '/', 'http://localhost')
    const method = (req.method || 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'POST') {
      return sendJson(res, 405, { error: { code: 'method-not-allowed', message: '不支持的请求方法' } })
    }
    if (method === 'POST' && req.headers?.['x-session-hub'] !== '1') {
      return sendJson(res, 403, { error: { code: 'missing-csrf-header', message: '缺少请求来源标记' } })
    }

    let body = null
    if (method === 'POST') {
      try {
        const text = await readBody(req, MAX_BODY)
        body = text === '' ? null : JSON.parse(text)
      } catch (error) {
        const tooLarge = error instanceof Error && /too large/i.test(error.message)
        return sendJson(res, tooLarge ? 413 : 400, {
          error: { code: tooLarge ? 'body-too-large' : 'bad-json', message: tooLarge ? '请求体过大' : '请求体不是合法 JSON' },
        })
      }
    }

    try {
      const result = await route(url, method, req, body)
      return sendJson(res, result.status ?? 200, result.body)
    } catch (error) {
      if (error instanceof HubError) {
        return sendJson(res, error.status, { error: { code: error.code, message: error.message } })
      }
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger?.warn?.(`session-hub: ${message}`)
      return sendJson(res, 500, { error: { code: 'internal', message } })
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler }), 'session-hub: routes')
}
