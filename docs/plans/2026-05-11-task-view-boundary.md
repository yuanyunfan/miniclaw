# Task View Boundary And Runner Refactor

Status: draft
Date: 2026-05-11

## Background

`src/agent/task.ts` still owns task lifecycle, Claude/Codex SDK execution, raw SDK event parsing, progress line formatting, Discord progress updates, final result delivery, DB status updates, and `TaskReporter` event persistence.

`TaskReporter` is now an observability writer backed by `task_events`. It should stay focused on structured trace persistence. It should not grow into a Discord rendering layer.

The target boundary is:

- Runtime runners normalize Claude/Codex/fake SDK events into user-visible `TaskViewEvent` values.
- A Discord reporter renders `TaskViewEvent` values into progress, final output, embeds, and attachments.
- `TaskReporter` or a renamed `TaskTraceReporter` writes structured trace facts to SQLite.
- `executeTask` becomes an orchestration shell.

## Goals

- Define a minimal `TaskViewEvent` union in `src/agent/task-view-events.ts`.
- Extract Claude and Codex runner modules that hide provider-specific streaming event schemas.
- Add `src/discord/task-view-reporter.ts` for Discord status/progress/final rendering.
- Keep DB writes and Discord rendering separate by type, file name, and tests.
- Preserve current task behavior while moving code behind clearer interfaces.
- Make future SDK event schema changes local to the relevant runner.

## Non-Goals

- Do not redesign task creation, task thread creation, Smart Router, slash command intake, or cron task intake in this slice.
- Do not change provider selection semantics beyond moving provider-specific execution into runner modules.
- Do not introduce multi-agent execution.
- Do not remove `TaskReporter` until all call sites are migrated and tests prove trace behavior is preserved.
- Do not change Discord message copy unless required by the new renderer tests.

## Existing Architecture Evidence

- `src/agent/task.ts`: current god module for task execution, streaming progress, final Discord output, lifecycle, and DB updates.
- `src/agent/task-reporter.ts`: structured SQLite event writer using `src/store/task-events.ts`.
- `src/store/task-events.ts`: `appendTaskEvent`, `listTaskEvents`, and `countTaskEvents`.
- `src/discord/task-intake.ts`: shared task creation path for slash, Smart Router, and task-channel intake.
- `src/commands/handlers.ts`: `/resume` still creates a `TaskReporter` directly and calls `executeTask`.
- `src/agent/__tests__/e2e-fake-runtime.test.ts`: fake runtime coverage that should remain green.
- `package.json`: core gates are `typecheck`, `lint`, `test`, `build`, and `quality:docs`.

## Proposed Boundaries

### `TaskViewEvent`

Start with a small union; expand only when a real rendering need appears.

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

Rules:

- Events are user-visible and redacted by construction.
- Raw provider payloads belong in trace payloads only after redaction, not in Discord view events.
- `TaskViewEvent` should not import Discord types or SQLite types.

### Runner Contract

Create `src/agent/runners/types.ts`.

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

The runner should own SDK-specific event parsing. It should not own Discord message mutation, task DB row updates, or thread creation.

### Discord View Reporter

Create `src/discord/task-view-reporter.ts`.

Responsibilities:

- Send or update progress text.
- Throttle progress edits.
- Format final output and chunk oversized text.
- Preserve current embed/raw result behavior.
- Report Discord delivery failures back to `TaskReporter`.

It may depend on Discord channel/message types and existing formatter helpers. It should not parse Claude/Codex SDK events.

## Implementation Plan

1. Add tests around the current rendering behavior before moving code.
   - Capture progress formatting expectations from `src/agent/task.ts`.
   - Cover fake runtime progress and final result output.
   - Keep tests narrow and deterministic.
2. Add `src/agent/task-view-events.ts`.
   - Define the union and helper builders for common events.
   - Include a small redaction helper for event text if no existing helper fits.
3. Add `src/agent/runners/types.ts`.
   - Define `TaskRunnerInput`, `TaskRunner`, and any `TaskResult` imports/re-exports needed by the runner boundary.
   - Keep the initial contract small enough to migrate without touching all task intake paths.
4. Extract provider-neutral orchestration from `executeTask`.
   - Leave public `executeTask(params)` stable.
   - Move provider selection into a local `selectTaskRunner(config.agentProvider)` helper first.
   - Keep DB row status updates in `executeTask`.
5. Extract Claude runner.
   - Move Claude SDK setup and event parsing from `task.ts` into `src/agent/runners/claude-task-runner.ts`.
   - Convert raw SDK stream events to `TaskViewEvent` and trace callbacks.
   - Preserve session id format through `src/agent/session.ts`.
6. Extract Codex runner.
   - Move Codex SDK setup and event parsing into `src/agent/runners/codex-task-runner.ts`.
   - Keep Codex sandbox/web search/network config behavior unchanged.
7. Extract fake/E2E runtime handling only if needed.
   - If fake logic is already isolated enough, wrap it with the same runner contract.
   - Do not break `MINICLAW_E2E_FAKE_AGENT`.
8. Add `src/discord/task-view-reporter.ts`.
   - Start by moving existing progress/final formatting functions with minimal text changes.
   - Implement `handle(event: TaskViewEvent)` plus explicit `finish(result)` if that maps better to existing code.
   - Surface delivery failures via an injected callback rather than direct DB imports.
9. Rename or clarify `TaskReporter` only after migration.
   - Option A: keep `TaskReporter` but update comments/tests to call it trace/observability reporter.
   - Option B: introduce `TaskTraceReporter` as a new name and re-export `TaskReporter` temporarily for compatibility.
10. Reduce `src/agent/task.ts`.
    - It should own active task registry, abort handling, status transitions, runner selection, trace reporter creation, and Discord view reporter wiring.
    - It should not contain large provider-specific event `switch` blocks or Discord progress line formatting.

## Suggested File Ownership

- New files:
  - `src/agent/task-view-events.ts`
  - `src/agent/runners/types.ts`
  - `src/agent/runners/claude-task-runner.ts`
  - `src/agent/runners/codex-task-runner.ts`
  - `src/discord/task-view-reporter.ts`
- Likely touched files:
  - `src/agent/task.ts`
  - `src/agent/task-reporter.ts`
  - `src/agent/__tests__/*.test.ts`
  - `src/discord/formatter.ts`
  - `docs/architecture.md`
  - `docs/features/03-discord-task-output.md`

## Verification Plan

- Focused tests:
  - `pnpm vitest run src/agent/__tests__/e2e-fake-runtime.test.ts`
  - Add and run runner/view-reporter tests created in this slice.
- Static checks:
  - `pnpm run typecheck`
  - `pnpm run lint`
- Regression:
  - `pnpm test`
  - `pnpm run build` if any exported module boundary changes.
- Optional runtime smoke:
  - `MINICLAW_E2E_FAKE_AGENT=true pnpm run e2e:discord` only when Discord test secrets are available and explicitly intended.

## Risks And Rollback

- Risk: Discord progress output changes unintentionally.
  - Mitigation: snapshot current progress/final formatting before extraction.
  - Rollback: keep new runner contract but route rendering back through the old function until tests are repaired.
- Risk: Abort/cancel behavior changes during runner extraction.
  - Mitigation: keep abort controller ownership in `executeTask`; pass only `signal` to runners.
  - Rollback: move provider runner code back behind the same orchestration shell.
- Risk: trace and view events diverge.
  - Mitigation: name the types separately and write tests proving `TaskReporter` persists trace events independently from Discord rendering.
- Risk: one giant refactor becomes hard to review.
  - Mitigation: land in two or three commits: types/tests, runner extraction, Discord reporter extraction.

## Documentation Sync

- Update `docs/architecture.md` task execution section with the new runner/view/trace split.
- Update `docs/features/03-discord-task-output.md` or equivalent Discord output doc if message behavior changes.
- Update `docs/continuous-improvement-report.md` only after implementation if this task is no longer open.
- Run `pnpm run quality:docs`.

## Execution Notes

Record the final module boundary, changed files, and verification commands here when implemented.

