# Discord Task Output Design

本文档记录 MiniClaw task 在 Discord 中的输出改造方案。目标是保留 Codex SDK / Claude Agent SDK 的实时执行进度，同时让最终结果更适合 Discord 阅读。

## 背景

当前 `/task` 的执行链路是：

- `/task` handler 创建 Discord thread，并发送 `taskStartEmbed`。
- `executeTask` 根据 `MINICLAW_AGENT_PROVIDER` 选择 Codex SDK 或 Claude Agent SDK。
- SDK 执行期间，MiniClaw 把工具调用事件压缩成进度行，通过 `ProgressReporter` 持续 edit 一条普通消息。
- 任务完成后，MiniClaw 发送 `taskCompleteEmbed`。

关键代码：

- `src/commands/handlers.ts`: `/task` 入口、创建 thread、发送开始 embed。
- `src/agent/task.ts`: 执行 Codex / Claude task，消费 SDK 事件，发送最终结果。
- `src/discord/progress.ts`: 维护一条实时进度消息。
- `src/discord/formatter.ts`: 构造 task start / complete / error embed。
- `src/discord/chunks.ts`: 普通 Discord 消息分片。

## 当前问题

### 1. 最终结果放在 embed description 中

`taskCompleteEmbed` 当前把完整结果放进 embed description。Discord embed 更适合状态卡片和短摘要，不适合承载长报告。

影响：

- 视觉上是窄卡片，没有充分利用 Discord 内容区宽度。
- 长段落、列表、代码块和类表格内容更拥挤。
- 报告型输出的阅读体验不如普通 Markdown 消息。

### 2. 成功后进度消息会被删除

`ProgressReporter.complete()` 成功时会删除进度消息。用户能在执行中看到进度，但任务完成后无法回看中间执行过程。

影响：

- 实时性存在，但可追溯性不足。
- 最终的执行轨迹和实时进度不是同一条上下文。

### 3. 结果和轨迹展示割裂

当前最终结果、执行轨迹、进度消息分别由不同代码路径处理，缺少统一的 task view 模型。

影响：

- Codex 和 Claude 的 SDK 事件没有统一抽象。
- 后续扩展 tokens、turn、工具统计、heartbeat、trace 附件会变复杂。

### 4. 长结果可能重复

当前逻辑在 embed description 放截断结果；如果结果超过 4096 字符，再额外发送完整分片。

影响：

- 用户会看到开头重复。
- 输出顺序不够清晰。

## 目标设计

推荐采用三层输出：

### 1. 状态卡片：短 embed

embed 只承载任务元数据和状态，不承载完整结果。

建议字段：

- Task ID
- Provider / Model
- CWD
- Session
- Status
- Elapsed
- Turns
- Tokens
- Tool calls

状态卡片从 `running` 一路 edit 到 `completed` / `failed` / `cancelled`。

### 2. 实时进度：persistent progress message

保留一条普通消息作为实时进度区，执行过程中持续 edit。成功后不删除，而是 edit 成最终执行摘要。

运行中示例：

```text
### Realtime Progress
status: running
elapsed: 01:42
turns: 3
tools: 12

recent steps:
- web_search: warp github
- terminal: git clone ...
- terminal: rg "..."
- files: README.md, package.json
- todo: 3/6
```

完成后示例：

```text
### Execution Summary
status: completed
elapsed: 132.4s
turns: 6
tools: 18
tokens: input 120k / output 8k

recent steps:
- web_search: ...
- terminal: ...
- files: ...
```

建议策略：

- 进度更新节流从 500ms 调整到约 2s，降低 Discord rate limit 风险。
- 如果 30s 没有 SDK 事件，可 heartbeat 一次，显示任务仍在运行。
- 只保留最近 N 条步骤，完整 trace 另存附件或数据库。

### 3. 最终结果：普通 Markdown 消息

最终回答不再放入 embed description，而是直接通过普通 Discord 消息发送。

示例：

```markdown
## Warp 项目深度分析

> TLDR: ...

### 1. 项目定位

...
```

策略：

- 所有最终结果都走 `chunkMessage()`，不只处理超过 4096 字符的结果。
- 普通消息能更好利用 Discord 横向宽度。
- embed description 只保留类似 `Task completed. Result follows below.` 的短文案。
- 如果结果非常长，发送 TLDR 到频道，同时上传完整 Markdown 附件。

## SDK 事件模型

MiniClaw 不应复制 Codex CLI 的 terminal UI，而应复用 Codex SDK / Claude Agent SDK 的结构化事件，重建 Discord-native task view。

### Codex SDK 可映射事件

当前已使用的 Codex 事件包括：

- `thread.started`: 获取 session / thread id。
- `turn.started`: 轮次开始。
- `turn.completed`: 获取 usage / tokens。
- `command_execution`: 命令执行。
- `file_change`: 文件变化。
- `mcp_tool_call`: MCP 工具调用。
- `web_search`: 搜索。
- `todo_list`: todo 进度。
- `agent_message`: 最终或阶段性文本。
- `error`: 错误。

### Claude Agent SDK 可映射事件

当前已使用的 Claude 事件包括：

- `system`: 获取 session id。
- `assistant` 中的 `tool_use`: 工具调用。
- `result`: 最终结果、耗时、费用、turns、usage。

### 建议统一事件

新增内部统一事件类型，供 Discord renderer 使用：

```ts
type TaskViewEvent =
  | { type: "task_started"; provider: "codex" | "claude"; model: string; taskId: string; cwd: string }
  | { type: "session_started"; sessionId: string }
  | { type: "turn_started"; turn: number }
  | { type: "usage_updated"; tokensSummary: string }
  | { type: "tool_call"; label: string; detail?: string }
  | { type: "file_change"; summary: string }
  | { type: "todo"; done: number; total: number }
  | { type: "result"; success: boolean; text: string }
  | { type: "error"; message: string };
```

Codex / Claude 适配层负责把 SDK 原始事件转换为 `TaskViewEvent`。Discord 层只消费 `TaskViewEvent`。

## 推荐实施阶段

### Phase 1: 先修最终结果宽度

目标：最小改动解决当前最明显的问题。

改动：

- `taskCompleteEmbed` 不再接收完整 `result` 作为 description。
- `executeTask` 在 embed 模式下始终用 `chunkMessage(lastResult.result)` 发送普通 Markdown 结果。
- 删除 `lastResult.result.length > 4096` 的特殊分支，避免重复发送。
- `taskErrorEmbed` 可以继续使用 embed，但长 error 也应可分片。

验证：

- `/task` 短结果不再塞进绿色 embed。
- `/task` 长结果不重复。
- cron 的 `outputMode: raw` 行为不受影响。

### Phase 2: 保留实时进度消息

目标：保留实时性，同时让完成后的进度可回看。

改动：

- `ProgressReporter.complete()` 成功时不 delete，而是 edit 为最终摘要。
- 更新节流从 500ms 调整到约 2s。
- 增加 `finalize(summary)` 或 `complete({ finalText })` 接口。

验证：

- 任务执行中只有一条 progress message 被持续 edit。
- 成功后 progress message 保留。
- 失败后 progress message 仍保留，并标记失败。

### Phase 3: 引入 TaskReporter

目标：把 SDK 执行逻辑和 Discord 展示逻辑解耦。

建议新增：

- `src/discord/task-reporter.ts`
- `src/agent/task-events.ts`

`TaskReporter` 负责：

- 创建 / 更新状态 embed。
- 创建 / 更新 progress message。
- 发送最终 Markdown 结果。
- 发送 trace 摘要或附件。

`executeTask` 负责：

- 执行 SDK。
- 把 SDK 原始事件转换为 `TaskViewEvent`。
- 调用 `TaskReporter.onEvent(event)`。

验证：

- Codex provider 和 Claude provider 输出形态一致。
- Codex provider 保留更丰富的 command / file / todo / search trace。
- Claude provider 至少保留 tool_use trace。

### Phase 4: 完整 trace 附件

目标：长任务可审计，不污染 Discord 主消息流。

策略：

- 维护完整 trace 数组。
- 任务完成后如果 trace 超过阈值，上传 `task-<id>-trace.md`。
- 如果最终结果超过阈值，上传 `task-<id>-result.md`。

附件内容建议：

- task metadata
- provider / model
- session id
- started_at / completed_at
- normalized trace
- final result

## 非目标

### 不复制 Codex CLI 的 terminal TUI

Codex CLI 的输出面向 terminal，依赖终端宽度、动态区域和 TUI 行为。Discord 不适合原样复刻。

MiniClaw 应迁移的是 Codex CLI 背后的信息结构：

- 实时事件流
- 工具调用轨迹
- 文件变化
- 最终回答
- usage / turns / session

而不是 terminal UI 本身。

### 不把所有 trace 都发成 Discord 消息

完整 trace 可能很长。主消息流只展示最近步骤和摘要，完整 trace 通过附件或数据库保存。

## 成功标准

- 最终报告在 Discord 中以普通 Markdown 消息展示，能充分利用内容宽度。
- 状态 embed 只显示元数据，不承载长正文。
- 实时进度消息在任务完成后仍可回看。
- Codex SDK 的 command / file / web / todo 事件能在进度区体现。
- Claude provider 仍能显示基本 tool trace。
- 长结果不重复发送。
- cron 的 `outputMode: raw` 不受 `/task` 展示改造影响。
