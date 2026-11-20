# 会话管理（dsh-session-hub）

DSH 侧栏脚部的「会话管理」入口。点开后是一个全屏面板，用来跨项目管理所有会话，并把「发消息、改名字、归档、建目标、启动目标」放在同一处。

## 能做什么

| 分组 | 能力 |
| --- | --- |
| 会话通信 | 给任何会话发消息（排队 / 插话），**跨项目**；冷会话由宿主自动唤醒；Ctrl/⌘ + Enter 发送 |
| 会话管理 | 新建会话（可选目录、名称、Agent 预设）、更名、归档 / 取消归档、置顶 / 取消置顶、打开会话、复制会话、停止当前轮 |
| 目标 | 给任意会话新建目标、编辑目标、暂停、恢复、完成、清除；「新建并开始 / 开始」会立即给目标会话发一轮启动指令 |
| 浏览 | 按名称 / 项目 / 目录 / id 搜索，按项目筛选，可选显示已归档与子会话；列表显示运行状态、目标阶段与最近活跃时间 |
| 上下文 | 选中会话后显示最近 6 条对话，发消息前不用切过去看 |

侧栏入口上的绿色角标是当前运行中的会话数。

## 模型侧工具

除了 GUI，插件还注册了 4 个工具，让会话里的 Agent 也能跨项目操作：

| 工具 | 作用 |
| --- | --- |
| `session_hub_list` | 跨项目列出会话（标题、项目、运行中、归档、当前目标），可按关键词过滤 |
| `session_hub_message` | 给任意会话发消息（含跨项目、冷会话自动唤醒），正文带「来自哪个会话」，并给出回复方式 |
| `session_hub_goal` | 读取 / 新建 / 编辑 / 暂停 / 恢复 / 开始 / 完成 / 清除**任意会话**的目标；`start` 会立即给目标会话发一轮启动指令 |
| `session_hub_session` | 新建、更名、归档、取消归档、置顶、取消置顶 |

工具是宿主路由的薄封装，共用同一套校验与错误映射；工具注册失败只记日志，不影响 GUI 路由。

## 工作原理

宿主侧只调用 DSH 已有服务，不新增会话事件类型，也不落插件私有状态：

- 列表：`sessionController.list` + `sessionQuery.readTitleSnapshots`，标题优先用列表里的投影 hint；
- 归档 / 置顶集合：`workspaceController.follow` 的 baseline 与增量，断流时保留上一帧；
- 写操作：`sessionController.create / rename / prompt / cancel / fork`，`workspaceRegistry.archiveSession / unarchiveSession / pinSession / unpinSession`；
- 目标：`sessionController.resolveAgent` 拿到在线 Agent 后调用 `ctx.goals`，所以可以给**别的会话**建目标、改目标、启动目标；
- 项目名：`workspaceRegistry.list()`，没有登记工作区的会话退回目录名。

所有接口都在 `/session-hub/api/*`，只信任本机回环 Host + 同源 Origin；POST 还要求 `x-session-hub: 1` 头，挡住普通跨站表单。

## 使用

1. 在「插件」页启用本插件（或把它加进 profile 的 bundles）；
2. 刷新页面，侧栏底部出现列表图标；
3. 点开即可管理；需要宿主侧生效的改动要重启 DSH，纯客户端改动刷新页面即可。

## 安装（本机开发）

```powershell
# 在 profile 的 package.json 里加 link 依赖，并把包名加进 dsh.profile.bundles
"@local/dsh-session-hub": "link:C:/Projects/work/dsh-plugins/dsh-session-hub"
pnpm install --ignore-scripts
```

## 自测

```powershell
npm test        # 宿主路由 + 模型工具：43 项断言，假服务覆盖列表/新建/更名/归档/置顶/消息/目标/安全守卫
```

客户端改动另用 dsh-plugin-dev 的 `client-harness.mjs` 渲染 `sidebar.footer.action`，再在 390px 视口核对一次布局。

## 已知边界

- 冷会话的「当前目标」在列表里显示为空，只有在线会话能同步读 `ctx.goals`；对它执行目标动作时宿主会先唤醒该会话。
- 归档运行中的会话会先要求二次确认，确认后带 `stopActivity` 停止当前工作。
- 插件不做会话删除（DSH 没有删除接口），归档是唯一的收起方式。
