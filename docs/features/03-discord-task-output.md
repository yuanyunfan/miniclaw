# Discord Task Output Design

本文档记录 MiniClaw task 在 Discord 中的输出改造方案与当前落地状态。目标是保留 Codex SDK / Claude Agent SDK 的实时执行进度，同时让最终结果更适合 Discord 阅读。

## 当前状态

截至 2026-05-12，Phase 1、Phase 2、runner 边界、Discord view reporter 和观测侧 trace 已经落地：

- `/task` 开始时发送短 embed 状态卡片，完成时 edit 为 completed / failed 元数据卡片。
- 完整最终结果不再放入 embed description，而是始终通过普通 Markdown 消息分片发送。
- 任务执行中维护一条 persistent progress message，完成后 edit 成 `Execution Summary`，保留最近工具调用、turns、tools、tokens 等摘要。
- Codex provider 已把 `command_execution`、`file_change`、`mcp_tool_call`、`web_search`、`todo_list` 等 SDK item 映射为 Discord 进度行。
- progress 更新节流为约 2s，降低 Discord edit rate limit 风险。
- `tasks.progress_message_id` 已持久化，用于进程重启后把悬挂任务标记为 interrupted。
- Claude / Codex / fake runtime 已抽到 `src/agent/runners/*-task-runner.ts`，由 runner 把 SDK 原始事件转换为 provider-neutral `TaskViewEvent`。
- `executeTask` 已通过 `src/agent/runtimes/registry.ts` 解析默认 `AgentRuntime` 并调用 `runtime.startTask`；`runtime.default_agent` 是当前 task runtime 首选配置，legacy `agent.provider` 只作为未配置时的兼容 alias，E2E fake task runner 也包装在同一 runtime contract 后面。
- `/task`、task channel、Smart Router auto-task 和 `/resume` 的开始 embed 统一展示 effective default `AgentRuntime` / model；resume 预检查也按 default runtime 校验 session 前缀，避免 `runtime.default_agent` 与 legacy `agent.provider` 不一致时误拒绝续话。
- `src/discord/task-view-reporter.ts` 已负责 status embed、progress message、Execution Summary、最终 Markdown/raw output 和 Discord delivery failure callback。
- `src/agent/task-reporter.ts` 已作为观测边界落地，把 task lifecycle、provider/tool event、Discord delivery failure 等规范化写入 SQLite `task_events`。
- `src/store/task-trace-export.ts`、`/task-log`、`pnpm run task:trace` 和 `tasks.trace_auto_attach` 已生成安全 Markdown trace；脱敏由 `src/privacy/diagnostic-redaction.ts` 统一处理。
- Auto Doctor 已读取 `task_events`，用于区分 provider、Discord delivery、network 和 MiniClaw runtime 类问题；`/incident view` 渲染 trace/evidence 前也复用 shared diagnostic redaction。

仍未落地的扩展：

- provider dry-run / diagnostic bundle 还没有统一 manifest；新增诊断入口必须复用 shared diagnostic redaction，不要直接输出 raw provider payload。

## 背景

当前 `/task` 的执行链路是：

- `/task` handler 创建 Discord thread，并发送 `taskStartEmbed`。
- `executeTask` 根据配置经 runtime registry 选择 `AgentRuntime`，并保留 active task、abort、DB lifecycle 和 trace reporter 编排。
- Claude / Codex / fake runner 负责 provider-specific SDK setup 和 stream event parsing，并输出 redacted `TaskViewEvent`。
- `DiscordTaskViewReporter` 消费 `TaskViewEvent`，通过 `ProgressReporter` 持续 edit 一条普通 progress message。
- 任务完成后，`DiscordTaskViewReporter` edit 状态 embed，保留 progress summary，并用普通 Markdown 消息发送最终结果。

关键代码：

- `src/commands/handlers.ts`: `/task` 入口、创建 thread、发送开始 embed。
- `src/agent/task.ts`: orchestration shell，负责 runtime registry selection、abort、DB lifecycle、trace reporter 和 Discord view reporter wiring。
- `src/agent/runtimes/registry.ts`: 默认 coding-agent runtime registry，优先使用 `runtime.default_agent`，未配置时才把 legacy `agent.provider` 映射到 Claude / Codex `AgentRuntime`。
- `src/agent/runtimes/task-runner-runtime.ts`: 把现有 `TaskRunner` 适配成 `AgentRuntime.startTask`。
- `src/agent/runners/claude-task-runner.ts`: Claude Agent SDK setup、tool permission/MCP/subagent wiring、stream parsing 和 `TaskViewEvent` emission。
- `src/agent/runners/codex-task-runner.ts`: Codex SDK thread setup、timeout/session/usage handling、stream parsing 和 `TaskViewEvent` emission。
- `src/agent/runners/fake-task-runner.ts`: deterministic fake runtime runner，用于 E2E/runtime regression。
- `src/agent/task-view-events.ts`: provider-neutral user-visible event contract 和 redaction helper。
- `src/discord/task-view-reporter.ts`: Discord status/progress/final output renderer。
- `src/agent/task-reporter.ts`: 规范化 task lifecycle / provider / tool / Discord delivery 事件，写入 `task_events`；不负责 Discord rendering。
- `src/store/task-events.ts`: `task_events` 表的 append/list/count store API。
- `src/store/task-trace-export.ts`: 把 `task_events` 投影为 allowlist-only 的安全 Markdown trace。
- `src/privacy/diagnostic-redaction.ts`: task trace、incident detail 等诊断导出的共享脱敏策略。
- `src/discord/progress.ts`: 维护一条实时进度消息。
- `src/discord/formatter.ts`: 构造 task start / complete / error embed。
- `src/discord/chunks.ts`: 普通 Discord 消息分片。

## 改造前问题

### 1. 最终结果放在 embed description 中

旧实现把完整结果放进 `taskCompleteEmbed` description。Discord embed 更适合状态卡片和短摘要，不适合承载长报告。

影响：

- 视觉上是窄卡片，没有充分利用 Discord 内容区宽度。
- 长段落、列表、代码块和类表格内容更拥挤。
- 报告型输出的阅读体验不如普通 Markdown 消息。

### 2. 改造前成功后进度消息会被删除

旧实现里 `ProgressReporter.complete()` 成功时会删除进度消息。用户能在执行中看到进度，但任务完成后无法回看中间执行过程。

影响：

- 实时性存在，但可追溯性不足。
- 最终的执行轨迹和实时进度不是同一条上下文。

### 3. 结果和轨迹展示割裂

最终结果、执行轨迹、进度消息仍由不同代码路径处理，缺少统一的 task view 模型。

影响：

- Codex 和 Claude 的 SDK 事件没有统一抽象。
- 后续扩展 tokens、turn、工具统计、heartbeat、trace 附件会变复杂。

### 4. 长结果可能重复

旧逻辑在 embed description 放截断结果；如果结果超过 4096 字符，再额外发送完整分片。

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

当前内部统一事件类型供 Discord renderer 使用；完整定义以 `src/agent/task-view-events.ts` 为准：

```ts
type TaskViewEvent =
  | { type: "task_started"; taskId: string; provider: string; model?: string; cwd: string }
  | { type: "session_started"; provider: string; sessionId: string }
  | { type: "turn_started"; provider: string; turn: number }
  | { type: "tool_progress"; provider: string; title: string; detail?: string; severity?: "info" | "warning" | "error"; countAsTool?: boolean }
  | { type: "assistant_progress"; provider: string; text: string }
  | { type: "provider_error"; provider: string; message: string; errorType?: string }
  | { type: "task_completed"; result: TaskResult }
  | { type: "task_failed"; message: string; errorType?: string };
```

Codex / Claude 适配层负责把 SDK 原始事件转换为 `TaskViewEvent`。Discord 层只消费 `TaskViewEvent`。

## 推荐实施阶段

### Phase 1: 先修最终结果宽度（已完成）

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

### Phase 2: 保留实时进度消息（已完成）

目标：保留实时性，同时让完成后的进度可回看。

改动：

- `/task` embed 模式下，`ProgressReporter.complete()` 成功时不 delete，而是 edit 为最终摘要。
- 更新节流从 500ms 调整到约 2s。
- 增加 `finalize(summary)` 或 `complete({ finalText })` 接口。

验证：

- 任务执行中只有一条 progress message 被持续 edit。
- 成功后 progress message 保留。
- 失败后 progress message 仍保留，并标记失败。

### Phase 3: 引入 TaskReporter / Task Events（已完成）

目标：先把可诊断 trace 从 `task.ts` 中规范化出来，再逐步把 SDK 执行逻辑和 Discord 展示逻辑解耦。

已新增：

- `src/agent/task-reporter.ts`
- `src/store/task-events.ts`
- SQLite `task_events` 表

当前 `TaskReporter` 负责：

- 写入 task accepted / context captured / session / turn / tool / provider error / Discord delivery failure / final status。
- 保证观测写入 best-effort，失败时只记录 warn，不影响 task 执行、取消或 shutdown drain。
- 为 Auto Doctor 提供结构化 trace evidence。

### Phase 4: Runner / Discord View Boundary（已完成）

目标：把 provider-specific runtime parsing、Discord rendering 和 SQLite trace writing 分开。

已新增：

- `src/agent/task-view-events.ts`
- `src/agent/runners/types.ts`
- `src/agent/runners/claude-task-runner.ts`
- `src/agent/runners/codex-task-runner.ts`
- `src/agent/runners/fake-task-runner.ts`
- `src/discord/task-view-reporter.ts`

当前职责：

- `TaskRunner` 执行 Claude / Codex / fake runtime，输出 redacted `TaskViewEvent`，并通过 `onTraceEvent` 上报结构化 trace facts。
- `AgentRuntime` registry 是 `executeTask` 的选择边界；当前 runtime shim 仍复用已有 `TaskRunner`，所以 Discord 输出和 runner event contract 不变。
- `DiscordTaskViewReporter` 创建 / 更新状态 embed、progress message、Execution Summary、最终 Markdown/raw result，并把 delivery failure 交给注入的 callback。
- `TaskReporter` 只写 SQLite `task_events`。
- `executeTask` 只负责 active task registry、abort ownership、runtime selection、DB task row lifecycle、trace reporter 创建和 view reporter wiring。

验证：

- `src/agent/__tests__/task-reporter.test.ts` 覆盖事件写入。
- `src/agent/__tests__/task-runners.test.ts` 覆盖 runner contract exports 和 fake runner view/trace behavior。
- `src/agent/__tests__/task-runtime-registry.test.ts` 覆盖 `executeTask` 经 `AgentRuntime.startTask` 执行任务和附件映射。
- `src/discord/__tests__/task-view-reporter.test.ts` 覆盖 progress/final formatting 和 `DiscordTaskViewReporter` render flow。
- `src/store/__tests__/task-events.test.ts` 覆盖 task event store。
- `src/ops/__tests__/doctor.test.ts` / `doctor-incidents.test.ts` 覆盖 Auto Doctor 读取 trace。
- `src/agent/__tests__/e2e-fake-runtime.test.ts` 覆盖 fake runtime 端到端 Discord output regression。

### Phase 5: 完整 trace 附件（待实现）

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
- 结构化 task trace 能写入 `task_events` 并被 Auto Doctor 使用。
- 长结果不重复发送。
- cron 的 `outputMode: raw` 不受 `/task` 展示改造影响。

## 回归验证记录

2026-05-07 做过一次 Discord E2E smoke test：

- 在 Discord `MiniClaw Hub #test` 通过 `/task` 触发 Codex 编码任务，生成一个本地 Tetris Web 游戏。
- 任务 ID：`2cf6c71b-f8b4-438c-8450-4336700a49c7`。
- DB 状态：`completed`；PM2 日志显示 `codex done turns=1 wall=132152ms tools=10`。
- Discord thread 中能看到三层输出：completed 状态 embed、保留的 `Execution Summary` progress message、最终普通 Markdown 结果。
- 本地 Playwright 额外验证生成页面可加载、canvas 非空、方向键 / hard drop / pause 可用。
