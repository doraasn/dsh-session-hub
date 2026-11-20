# 会话管理（dsh-session-hub）

给 DSH 会话里的 Agent 提供会话能力，不提供任何界面入口。设置页里可以逐项开关能力；关闭后工具仍会出现在模型工具列表里，但调用会被拒绝。

## 能力与工具

| 能力 | 工具 | 作用 |
| --- | --- | --- |
| 会话发现 | `session_hub_list` | 跨项目列出会话（标题、项目、运行中、归档、目标、是否免打扰），可按关键词过滤 |
| 跨会话消息 | `session_hub_message` | 给任意会话发消息（含跨项目、冷会话自动唤醒），正文带「来自哪个会话」，并给出回复方式 |
| 消息接收控制 | `session_hub_reception` | 每个会话自行关闭/恢复跨会话消息，声明写作用域；关闭后任何会话都绕不过 |
| 会话管理 | `session_hub_session` | 新建、更名、归档 / 取消归档、置顶 / 取消置顶、停止当前轮、复制会话 |
| 目标管理 | `session_hub_goal` | 读取、新建、编辑、暂停、恢复、开始、完成、清除**任意会话**的目标 |
| 对话预览 | `session_hub_preview` | 读取任意会话最近几条对话，发消息前先看上下文 |

没有侧栏按钮、没有管理面板、没有独立页面。

## 消息接收与写作用域

- 默认所有会话都接受跨会话消息；
- 会话可用 `session_hub_reception` 把自己设为 `enabled:false`，之后 `session_hub_message` 会返回 `target-paused`，**不能绕过**；
- 只能修改自己的接收设置，`get` 可以读任意会话；
- 子会话（`origin: 'subagent'`）不能作为跨会话消息目标，必须走父子通道；
- 发消息时可带 `writeScopes`，与其他会话已声明的路径重叠时返回 `conflicts`，只提示、不拦截。

## 设置

设置 → 会话管理：

- 6 个开关对应上面 6 项能力，默认全开；
- 开关立即保存到 `~/.dsh/storages/session-hub.json`，下一条工具调用就生效；
- 工具定义不会动态消失（DSH 的工具表在会话激活时固定），所以关闭的能力表现为「调用被拒绝」，错误信息会指出是哪一项；
- 每个会话的接收状态与写作用域单独存在 `~/.dsh/storages/session-hub-reception.json`。

## 目标语义（重要）

- 新建目标本身就是 `armed`，目标驱动器会在会话空闲时排下一轮，**不会**额外合成人类消息；
- `start` / `resume` 无条件调用 `ctx.goals.resume`，用于会话重启、fork 或 disarmed 后重新启用续行；active 也会真正 rearm，不是空操作；
- 只有 goal 消息消耗 `maxGoalRounds`，插件不注入任何合成用户消息，因此不会绕过轮次预算，也不会一次启动产生两条 `goal_round`；
- 已完成的目标不能 start / resume，会返回 409；目标服务的业务错误统一映射为 409，不落成 500。

## 实现

宿主侧只调用 DSH 已有服务，不新增会话事件类型：

- 列表：`sessionController.list` + `sessionQuery.readTitleSnapshots`（标题有 60 秒缓存），归档/置顶集合来自 `workspaceController.follow` 的 baseline 与增量；
- 会话：`sessionController.create / rename / cancel / fork`，`workspaceRegistry.archiveSession / unarchiveSession / pinSession / unpinSession`；
- 目标：`sessionController.resolveAgent` 拿到在线 Agent 后调用 `ctx.goals`，所以可以操作**别的会话**的目标；
- 预览：`sessionQuery.readSession` 折叠最近 20 条用户/助手消息，5 秒缓存。

设置接口在 `/dsh-session-hub/api/capabilities`，只信任本机回环 Host + 同源 Origin；POST 额外要求 `x-session-hub: 1` 头。本机进程视为可信，接口不读取会话正文。

## 安装

```powershell
# profile 的 package.json 加 link 依赖，并把包名加入 dsh.profile.bundles
"@local/dsh-session-hub": "link:C:/Projects/work/dsh-plugins/dsh-session-hub"
pnpm install --ignore-scripts
```

改动宿主侧代码后需要重启 DSH；只改客户端设置页刷新页面即可。

## 自测

```powershell
npm test
```

52 项断言，覆盖：能力开关的读写/落盘/拒绝、6 个工具注册、列表/预览/消息/会话/目标动作、接收免打扰与写作用域冲突、子会话拒绝、`start` 只调用 `goals.resume` 且不产生 `prompt`、active 目标会真正 resume、已完成目标拒绝启动、revision 冲突、安全守卫。

## 与其他插件的区别

- 内置 `session_send` / `session_peers`（dsh-session-messaging）主要面向同一目录、在线会话；本插件不限制项目目录，且冷会话可唤醒。
- 本插件已吸收它的关键能力：按会话免打扰（`session_hub_reception`）、写作用域冲突提示、只允许顶层会话互发；`dsh-session-messaging` 已从当前 profile 卸载。
- 工具名使用 `session_hub_*`，与内置 `create_goal` / `update_goal` 不冲突。
