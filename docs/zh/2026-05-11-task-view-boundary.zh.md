# Task View Boundary 与 Runner 重构

状态：`draft`
日期：2026-05-11

## 背景

`src/agent/task.ts` 仍然负责 task lifecycle、Claude/Codex SDK execution、raw SDK event parsing、progress line formatting、Discord progress updates、final result delivery、DB status updates，以及 `TaskReporter` event persistence。

`TaskReporter` 现在是一个由 `task_events` 支撑的 observability writer。它应该专注于 structured trace persistence，不应该继续膨胀成 Discord rendering layer。

目标边界是：

- Runtime runners 将 Claude/Codex/fake SDK events normalize 成用户可见的 `TaskViewEvent` values。
- Discord reporter 将 `TaskViewEvent` values 渲染成 progress、final output、embeds 和 attachments。
- `TaskReporter` 或重命名后的 `TaskTraceReporter` 将 structured trace facts 写入 SQLite。
- `executeTask` 变成 orchestration shell。

## 目标

- 在 `src/agent/task-view-events.ts` 中定义最小 `TaskViewEvent` union。
- 抽取 Claude 和 Codex runner modules，隐藏 provider-specific streaming event schemas。
- 增加 `src/discord/task-view-reporter.ts`，用于 Discord status/progress/final rendering。
- 通过 type、file name 和 tests 分离 DB writes 与 Discord rendering。
- 在代码移动到更清晰接口背后时，保持当前 task behavior。
- 让未来 SDK event schema changes 局限在对应 runner 内。

## 非目标

- 本 slice 不重设计 task creation、task thread creation、Smart Router、slash command intake 或 cron task intake。
- 除了把 provider-specific execution 移入 runner modules 外，不改变 provider selection semantics。
- 不引入 multi-agent execution。
- 在所有 call sites 迁移且 tests 证明 trace behavior 保持前，不移除 `TaskReporter`。
- 除非新 renderer tests 要求，不改变 Discord message copy。

## 现有架构证据

- `src/agent/task.ts`：当前 task execution、streaming progress、final Discord output、lifecycle 和 DB updates 的 god module。
- `src/agent/task-reporter.ts`：使用 `src/store/task-events.ts` 的 structured SQLite event writer。
- `src/store/task-events.ts`：`appendTaskEvent`、`listTaskEvents` 和 `countTaskEvents`。
- `src/discord/task-intake.ts`：slash、Smart Router 和 task-channel intake 的共享 task creation path。
- `src/commands/handlers.ts`：`/resume` 仍然直接创建 `TaskReporter` 并调用 `executeTask`。
- `src/agent/__tests__/e2e-fake-runtime.test.ts`：应继续保持 green 的 fake runtime coverage。
- `package.json`：核心 gates 是 `typecheck`、`lint`、`test`、`build` 和 `quality:docs`。

## 拟议边界

### `TaskViewEvent`

从小 union 开始；只有真实 rendering 需求出现时才扩展。

```ts
export type TaskViewEvent =
  | { type: "task_started"; taskId: string; provider: string; model?: string; cwd: string }
  | { type: "session_started"; provider: string; sessionId: string }
  | { type: "turn_started"; provider: string; turn: number }
  | { type: "tool_progress"; provider: string; title: string; detail?: string; severity?: "info" | "warning" | "error" }
  | { type: "assistant_progress"; provider: string; text: string }
  | { type: "provider_error"; provider: string; message: string; errorType?: string }
  | { type: "task_completed"; result: TaskResult }
  | { type: "task_failed"; message: string; errorType?: string };
```

规则：

- Events 由构造保证 user-visible 和 redacted。
- Raw provider payloads 只属于 redaction 后的 trace payloads，不属于 Discord view events。
- `TaskViewEvent` 不应 import Discord types 或 SQLite types。

### Runner Contract

创建 `src/agent/runners/types.ts`。

```ts
export interface TaskRunnerInput {
  taskId: string;
  prompt: string;
  cwd: string;
  resumeSessionId?: string;
  signal: AbortSignal;
  onViewEvent: (event: TaskViewEvent) => Promise<void> | void;
  onTraceEvent: (eventType: string, payload?: unknown) => void;
}

export interface TaskRunner {
  provider: "claude" | "codex" | "fake";
  run(input: TaskRunnerInput): Promise<TaskResult>;
}
```

Runner 应负责 SDK-specific event parsing。它不负责 Discord message mutation、task DB row updates 或 thread creation。

### Discord View Reporter

创建 `src/discord/task-view-reporter.ts`。

职责：

- Send 或 update progress text。
- Throttle progress edits。
- Format final output 并 chunk oversized text。
- 保留当前 embed/raw result behavior。
- 将 Discord delivery failures 报回 `TaskReporter`。

它可以依赖 Discord channel/message types 和现有 formatter helpers。它不应解析 Claude/Codex SDK events。

## Ralph 迭代目标

Ralph 应把下面每个 target 当成一个 coherent reviewable phase。不要只落一个 helper、type 或 test，除非选中的 target 明确说这就是整个 phase。

### Target 1：Contracts And Characterization

状态：已在 slices 1-4 中落地；除非后续 targets 需要 cleanup，否则不要重复。

- 用 focused fake-runtime tests 锁定当前 rendering behavior。
- 增加 provider-neutral `TaskViewEvent` contract。
- 增加 `TaskRunner` contract。
- 在 `executeTask` 中增加 runner selection boundary。
- 保持当前 task behavior，并保持 production runtime wiring 最小。

### Target 2：Runner Extraction

下一个 Ralph phase target。

- 在 `TaskRunner` contract 后面抽取 fake、Claude 和 Codex runner modules。
- 将 provider-specific SDK setup 和 event parsing 从 `src/agent/task.ts` 移出。
- 将 provider stream events 转换成 redacted `TaskViewEvent` values，并分离 trace callbacks。
- 保持 `executeTask(params)` public shape、DB lifecycle writes、abort ownership 和当前 session id formats 稳定。
- 在同一 phase 中增加 runner-focused tests 和 fake-runtime regression coverage。

### Target 3：Discord View Reporter And Docs

本计划最终 Ralph phase target。

- 增加 `src/discord/task-view-reporter.ts`。
- 将 progress、final output、embed、chunking 和 delivery-failure rendering 从 `src/agent/task.ts` 移出。
- 让 `TaskReporter` 专注于 structured trace persistence，或只在具备 compatibility re-exports 时重命名。
- 更新 architecture 和 Discord task output docs。
- 运行完整 task-runtime verification profile；完成并验证后，将本计划标记为 `Status: done`。

## 实施计划

1. 移动代码前，围绕当前 rendering behavior 增加测试。
   - 从 `src/agent/task.ts` 捕获 progress formatting expectations。
   - 覆盖 fake runtime progress 和 final result output。
   - 保持 tests narrow and deterministic。
2. 增加 `src/agent/task-view-events.ts`。
   - 定义 union 和 common events 的 helper builders。
   - 如果没有合适的现有 helper，包含一个小 redaction helper 处理 event text。
3. 增加 `src/agent/runners/types.ts`。
   - 定义 `TaskRunnerInput`、`TaskRunner`，以及 runner boundary 需要的任何 `TaskResult` imports/re-exports。
   - 保持初始 contract 足够小，避免触及所有 task intake paths。
4. 从 `executeTask` 抽出 provider-neutral orchestration。
   - 保持 public `executeTask(params)` 稳定。
   - 先将 provider selection 移入 local `selectTaskRunner(config.agentProvider)` helper。
   - 将 DB row status updates 保留在 `executeTask` 中。
5. 抽取 Claude runner。
   - 将 Claude SDK setup 和 event parsing 从 `task.ts` 移入 `src/agent/runners/claude-task-runner.ts`。
   - 将 raw SDK stream events 转成 `TaskViewEvent` 和 trace callbacks。
   - 通过 `src/agent/session.ts` 保持 session id format。
6. 抽取 Codex runner。
   - 将 Codex SDK setup 和 event parsing 移入 `src/agent/runners/codex-task-runner.ts`。
   - 保持 Codex sandbox/web search/network config behavior 不变。
7. 仅在需要时抽取 fake/E2E runtime handling。
   - 如果 fake logic 已经足够隔离，就用同一个 runner contract 包裹它。
   - 不破坏 `MINICLAW_E2E_FAKE_AGENT`。
8. 增加 `src/discord/task-view-reporter.ts`。
   - 先用最小 text changes 移动现有 progress/final formatting functions。
   - 实现 `handle(event: TaskViewEvent)`，如果更贴合现有代码，也可增加显式 `finish(result)`。
   - 通过 injected callback 暴露 delivery failures，而不是直接 import DB。
9. 只在迁移完成后 rename 或 clarify `TaskReporter`。
   - Option A：保留 `TaskReporter`，但更新 comments/tests，称其为 trace/observability reporter。
   - Option B：引入 `TaskTraceReporter` 作为新名，并临时 re-export `TaskReporter` 保持兼容。
10. 缩小 `src/agent/task.ts`。
    - 它应负责 active task registry、abort handling、status transitions、runner selection、trace reporter creation 和 Discord view reporter wiring。
    - 它不应包含大型 provider-specific event `switch` blocks 或 Discord progress line formatting。

## 建议文件所有权

- New files：
  - `src/agent/task-view-events.ts`
  - `src/agent/runners/types.ts`
  - `src/agent/runners/claude-task-runner.ts`
  - `src/agent/runners/codex-task-runner.ts`
  - `src/discord/task-view-reporter.ts`
- Likely touched files：
  - `src/agent/task.ts`
  - `src/agent/task-reporter.ts`
  - `src/agent/__tests__/*.test.ts`
  - `src/discord/formatter.ts`
  - `docs/architecture.md`
  - `docs/features/03-discord-task-output.md`

## 验证计划

- Focused tests：
  - `pnpm vitest run src/agent/__tests__/e2e-fake-runtime.test.ts`
  - 增加并运行本 slice 创建的 runner/view-reporter tests。
- Static checks：
  - `pnpm run typecheck`
  - `pnpm run lint`
- Regression：
  - `pnpm test`
  - 如果任何 exported module boundary 变化，运行 `pnpm run build`。
- Optional runtime smoke：
  - 仅在 Discord test secrets 可用且明确需要时运行 `MINICLAW_E2E_FAKE_AGENT=true pnpm run e2e:discord`。

## 风险与回滚

- 风险：Discord progress output 意外变化。
  - 缓解：extraction 前 snapshot 当前 progress/final formatting。
  - 回滚：保留新 runner contract，但在 tests 修复前让 rendering 回到旧函数。
- 风险：runner extraction 期间 Abort/cancel behavior 变化。
  - 缓解：在 `executeTask` 中保持 abort controller ownership；只向 runners 传递 `signal`。
  - 回滚：将 provider runner code 移回同一个 orchestration shell 后面。
- 风险：trace 和 view events 分叉。
  - 缓解：单独命名类型，并写测试证明 `TaskReporter` 独立于 Discord rendering 持久化 trace events。
- 风险：一个巨大 refactor 变得难以 review。
  - 缓解：分两到三个 commits 落地：types/tests、runner extraction、Discord reporter extraction。

## 文档同步

- 用新的 runner/view/trace split 更新 `docs/architecture.md` task execution section。
- 如果 message behavior 变化，更新 `docs/features/03-discord-task-output.md` 或等价 Discord output doc。
- 不要为了当前实现状态更新已归档的改进报告；应同步当前 source-of-truth 文档。
- 运行 `pnpm run quality:docs`。

## 执行记录

实现时在这里记录 final module boundary、changed files 和 verification commands。

### 2026-05-12 Slice 1：Rendering Behavior Tests

- 范围：第一个可独立交付 slice。移动 runner/view code 前，围绕当前 rendering behavior 增加测试。未修改 production runtime code。
- `src/agent/__tests__/e2e-fake-runtime.test.ts`：增加 recorded fake Discord channel test，锁定当前 embed-mode fake task output：start embed send、初始 `### Realtime Progress` message、`### Execution Summary` progress edit、completion embed edit、final Markdown result、DB completion fields，以及 persisted `progress_message_id`。
- `src/agent/__tests__/task-helpers.test.ts`：为 omitted earlier steps 和 retained last 25 progress lines 增加 progress tail coverage。
- 验证：
  - `pnpm vitest run src/agent/__tests__/e2e-fake-runtime.test.ts src/agent/__tests__/task-helpers.test.ts` 通过：2 files，24 tests。
  - `pnpm run typecheck` 通过。
  - `pnpm run lint` 通过。
  - `pnpm run quality:docs` 通过。

### 2026-05-12 Slice 2：TaskViewEvent Boundary Types

- 范围：Slice 1 tests 后第一个剩余可独立交付 boundary slice。只增加 provider-neutral `TaskViewEvent` contract 和 helper builders；未改变 runner、Discord reporter、DB lifecycle 或 `executeTask` wiring。
- `src/agent/task-view-events.ts`：增加 task/session/turn/progress/error/completion/failure events 的 minimal view-event union，一个用于 user-visible event text 的 bounded text redaction helper，以及会对 progress/error/result text 脱敏且不 import Discord 或 SQLite types 的 builder helpers。
- `src/agent/__tests__/task-view-events.test.ts`：覆盖 lifecycle event shape、progress/error/final result text 的 secret redaction、bounded progress text，以及 non-mutating task completion result cloning。
- 验证：
  - `pnpm vitest run src/agent/__tests__/task-view-events.test.ts` 通过：1 file，5 tests。
  - `pnpm vitest run src/agent/__tests__/e2e-fake-runtime.test.ts` 通过：1 file，4 tests。
  - `pnpm vitest run src/agent/__tests__/task-reporter.test.ts` 通过：1 file，1 test。
  - `pnpm vitest run src/store/__tests__/task-events.test.ts` 通过：1 file，1 test。
  - `pnpm run typecheck` 通过。
  - `pnpm run lint` 通过。
  - `pnpm ralph:verify -- --task task-view-boundary` 通过，profile 为 `task-runtime`，其中包含 `pnpm run quality:docs`。

### 2026-05-12 Slice 3：Runner Contract Types

- 范围：Slice 2 后第一个剩余可独立交付 boundary slice。只增加 runner contract types；未改变 provider execution、Discord reporter、DB lifecycle 或 `executeTask` wiring。
- `src/agent/runners/types.ts`：增加 `TaskRunnerProvider`、`TaskRunnerInput` 和 `TaskRunner`，让未来 Claude/Codex/fake runners 能 emit redacted `TaskViewEvent` values、分离 trace facts，并返回现有 `TaskResult`。
- `src/agent/__tests__/task-runner-types.test.ts`：增加 focused contract test，用 fake runner 覆盖 `onViewEvent`、`onTraceEvent`、provider union 和 `TaskResult` return shape。
- 验证：
  - `pnpm vitest run src/agent/__tests__/task-runner-types.test.ts src/agent/__tests__/task-view-events.test.ts` 通过：2 files，6 tests。
  - `pnpm run typecheck` 通过。
  - `pnpm run lint` 通过。
  - `pnpm ralph:verify -- --task task-view-boundary` 通过，profile 为 `task-runtime`，包含 fake runtime、trace reporter、task event store、typecheck、lint 和 `pnpm run quality:docs`。

### 2026-05-12 Slice 4：Runner Selection Boundary

- 范围：Slice 3 后第一个剩余可独立交付 orchestration slice。只在 `executeTask` 中增加 local runner selection boundary；未改变 provider execution code、Discord rendering、DB lifecycle writes 或 public `executeTask(params)` shape。
- `src/agent/task.ts`：增加 `selectTaskRunner(agentProvider, fakeAgent)`，将已配置 Claude/Codex provider 加 E2E fake override 规范化为现有 runner provider union，并通过该 selection result 路由当前 fake/Codex/Claude execution branches。
- `src/agent/__tests__/task-helpers.test.ts`：增加正常 Claude/Codex selection 和 E2E fake override selection 的 focused coverage。
- 验证：
  - `pnpm vitest run src/agent/__tests__/task-helpers.test.ts src/agent/__tests__/task-runner-types.test.ts` 通过：2 files，23 tests。
  - `pnpm run typecheck` 通过。
  - `pnpm run lint` 通过。
  - `pnpm ralph:verify -- --task task-view-boundary` 通过，profile 为 `task-runtime`，包含 fake runtime、trace reporter、task event store、typecheck、lint 和 `pnpm run quality:docs`。

### 2026-05-12 Slice 5：Runner Extraction

- 范围：完成 Target 2。将 fake、Codex 和 Claude runtime execution 抽到 `TaskRunner` modules 后面，同时保留 `executeTask(params)` 作为 public orchestration shell。Discord rendering 保留在 `src/agent/task.ts`，留给下一个 target。
- `src/agent/runners/fake-task-runner.ts`：在 `TaskRunner` 后面包裹 deterministic E2E fake task execution，emit provider-neutral view events，emit trace facts，并返回现有 Discord renderer 使用的 final progress metadata。
- `src/agent/runners/codex-task-runner.ts`：将 Codex SDK thread setup、timeout handling、stream event parsing、Codex session id formatting、token summary extraction 和 Codex tool progress conversion 从 `task.ts` 移出。
- `src/agent/runners/claude-task-runner.ts`：将 Claude SDK query setup、MCP/subagent/tool permission wiring、stream event parsing、Claude session id formatting、usage formatting 和 Claude tool progress conversion 从 `task.ts` 移出。
- `src/agent/task.ts`：现在选择一个 `TaskRunner`，把 abort `signal`、attachments、view callbacks 和 trace callbacks 传给 runner，从 `session_started` view events 更新 `session_id`，在 runner completion 后执行 final DB lifecycle writes，并保持现有 raw/embed Discord output behavior。
- `src/agent/runners/types.ts` 和 `src/agent/task-view-events.ts`：扩展 runner contract，增加 attachment inputs、trace event options、`TaskRunnerResult` progress metadata，以及用于 progress rendering compatibility 的 `countAsTool`。
- `src/agent/supervisor.ts` 和 `src/agent/runners/progress-lines.ts`：抽取 runners 需要的 shared prompt 和 progress-line helpers，避免 import `task.ts`。
- Tests：
  - `src/agent/__tests__/task-runners.test.ts`：为 exported Claude/Codex runners 和 fake runner view/trace/result behavior 增加 runner-focused coverage。
  - `src/agent/__tests__/task-helpers.test.ts`：更新 runner selection expectations，断言 actual runner providers。
  - `src/agent/__tests__/task-runner-types.test.ts`：为更丰富的 trace options contract 更新 trace callback coverage。
- 验证：
  - `pnpm vitest run src/agent/__tests__/task-runners.test.ts src/agent/__tests__/task-runner-types.test.ts src/agent/__tests__/task-helpers.test.ts src/agent/__tests__/e2e-fake-runtime.test.ts` 通过：4 files，29 tests。
  - `pnpm run typecheck` 通过。
  - `pnpm run lint` 通过。
  - `pnpm ralph:verify -- --task task-view-boundary` 通过，profile 为 `task-runtime`，包含 fake runtime、trace reporter、task event store、typecheck、lint 和 `pnpm run quality:docs`。
  - `pnpm run build` 通过；验证后删除了生成的 ignored `dist/` artifacts。

### 2026-05-12 Slice 6：Discord View Reporter And Docs

- 范围：完成 Target 3 和完整计划。将 Discord status/progress/final output rendering 从 `src/agent/task.ts` 移出，同时保持 public `executeTask(params)` shape、DB lifecycle writes、abort ownership、runner selection、trace persistence、fake-runtime behavior、raw output transform behavior，以及现有 embed/raw output modes。
- `src/discord/task-view-reporter.ts`：增加 `DiscordTaskViewReporter`，用于 start status embed creation、progress message updates、final `Execution Summary`、completion/error embeds、final Markdown/raw output delivery、delivery-failure callback routing 和 progress snapshot state。将 `rawTaskMessages`、`buildRealtimeProgress` 和 `buildExecutionSummary` 移入这个 Discord boundary。
- `src/agent/task.ts`：现在串联 `TaskRunner`、`TaskReporter` 和 `DiscordTaskViewReporter`；task DB row updates 和 session id persistence 保留在 `executeTask` 中，view rendering 委托给 Discord reporter。
- `src/discord/__tests__/task-view-reporter.test.ts`：增加 focused coverage，覆盖 raw fallback formatting、realtime progress tail behavior、execution summary formatting、duplicate progress compaction、status embed updates、final Markdown send 和 reporter snapshot state。
- `src/agent/__tests__/task-helpers.test.ts`：移除现在已由 Discord reporter tests 覆盖的 Discord-rendering helper assertions；保留 task runtime helper coverage。
- `docs/architecture.md` 和 `docs/features/03-discord-task-output.md`：更新 task runtime docs，描述 runner/view/trace split 以及已完成的 Discord view reporter phase。
- 验证：
  - `pnpm vitest run src/discord/__tests__/task-view-reporter.test.ts src/agent/__tests__/task-helpers.test.ts src/agent/__tests__/e2e-fake-runtime.test.ts` 通过：3 files，27 tests。
  - `pnpm run typecheck` 通过。
  - `pnpm run lint` 通过。
  - `pnpm run build` 通过；验证后删除了生成的 ignored `dist/` artifacts。
  - `pnpm ralph:verify -- --task task-view-boundary` 通过，profile 为 `task-runtime`，包含 fake runtime、trace reporter、task event store、typecheck、lint 和 `pnpm run quality:docs`。
