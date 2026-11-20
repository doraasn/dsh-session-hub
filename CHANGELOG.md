# CHANGELOG

## 0.1.0 — 2026-11-20

首个版本，只面向会话 Agent 提供工具能力，无侧栏入口。

- `session_hub_list`：跨项目列出会话。
- `session_hub_message`：给任意会话发消息，冷会话自动唤醒。
- `session_hub_session`：新建、更名、归档 / 取消归档、置顶 / 取消置顶、停止当前轮、复制会话。
- `session_hub_goal`：读取、新建、编辑、暂停、恢复、开始、完成、清除任意会话的目标。
- `session_hub_preview`：读取任意会话最近几条对话。
- 设置 → 会话管理：逐项开关 5 项能力，保存到 `~/.dsh/storages/session-hub.json`。
- `start` / `resume` 只调用 `ctx.goals.resume`，不注入合成人类消息，不绕过 `maxGoalRounds`。
- 设置接口只信任本机回环 + 同源，POST 额外要求 `x-session-hub: 1`。
