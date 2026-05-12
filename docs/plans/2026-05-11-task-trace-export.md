# Task Trace Export And Discord Task Log

Status: draft
Date: 2026-05-11

## Background

MiniClaw already persists structured task facts in `task_events`. Auto Doctor and incident views can read some task-related evidence, but the user does not yet have a direct, user-readable trace output for a recent task.

The missing surface is a safe `/task-log` or `/task trace` command and a Markdown exporter such as `task-<id>-trace.md`. The exporter must be useful for diagnosis while avoiding prompt, cookie, token, email, account, and provider payload leakage.

## Goals

- Add a reusable task trace Markdown exporter backed by `task_events`.
- Add a Discord slash command for recent task trace lookup by id prefix.
- Add a CLI for local trace export and debugging.
- Reuse the same exporter from Auto Doctor incident detail when possible.
- Add threshold-based automatic trace attachment for failed or long-running tasks.
- Enforce redaction and size limits by default.

## Non-Goals

- Do not expose full prompts, raw provider payloads, cookies, tokens, raw email bodies, broker account data, or attachment file contents.
- Do not replace Auto Doctor diagnosis.
- Do not build a web dashboard.
- Do not require Discord for local trace export.
- Do not make every successful short task upload a trace file by default.

## Existing Architecture Evidence

- `src/store/task-events.ts`: persists and lists task events.
- `src/agent/task-reporter.ts`: writes event types including `task_started`, `task_accepted`, `task_context_captured`, `session_started`, `turn_started`, `turn_completed`, `tool_event`, `provider_error`, `discord_delivery_failed`, and final status events.
- `src/store/db.ts`: task rows include task id, status, cwd, prompt, thread/source metadata, result summary, and session id.
- `src/commands/register.ts`: owns slash command registration.
- `src/commands/handlers.ts`: owns command handlers for `/status`, `/doctor`, `/incident`, `/resume`, and other commands.
- `src/commands/incident-detail.ts`: currently formats incident events and repair runs.
- `src/ops/doctor.ts`: already queries `task_events` for evidence.

## Data And Privacy Contract

### Safe Trace Fields

The default user trace may include:

- task id and status
- created/completed timestamps
- cwd
- route/source type
- source channel/thread/message ids or URLs when available
- provider name
- session id
- event type
- severity
- compact message
- selected payload keys from an allowlist
- elapsed time between events
- error type and sanitized error message

### Blocked Or Redacted Fields

The default user trace must not include:

- full prompt text
- raw `payload_json`
- cookies, tokens, API keys, session strings
- full email bodies or account numbers
- raw provider JSON
- local private file contents
- binary attachment contents
- unbounded stack traces

Use an allowlist first. Regex redaction is a second line of defense, not the main privacy model.

## Implementation Plan

1. Add `src/store/task-trace-export.ts`.
   - Export `resolveTaskForTrace(idPrefix: string)`.
   - Export `buildTaskTraceModel(taskId: string, options)`.
   - Export `renderTaskTraceMarkdown(model)`.
   - Read from `getTask`, `listTaskEvents`, and `countTaskEvents`.
   - Return explicit errors for missing id, ambiguous prefix, and task with no events.
2. Define trace event projection.
   - Parse `payload_json` defensively.
   - Keep payload keys through a per-event allowlist.
   - Add `redacted_payload_keys` count when keys are omitted.
   - Keep event ordering chronological in the rendered timeline.
3. Add redaction helpers.
   - Shared helper should redact common token-like and credential-like strings.
   - Add unit tests for token, cookie, authorization header, email body marker, account-like values, and long prompt-like payload.
   - Truncate every free-text field.
4. Add a local CLI.
   - New script: `scripts/task-trace.ts`.
   - Package script candidate: `"task:trace": "tsx scripts/task-trace.ts"`.
   - Usage examples:
     - `pnpm run task:trace -- --id <task-prefix>`
     - `pnpm run task:trace -- --id <task-prefix> --out /tmp/task-trace.md`
     - `pnpm run task:trace -- --id <task-prefix> --json`
5. Add a Discord slash command.
   - Prefer `/task-log id:<prefix>` if Discord command naming allows.
   - If command grouping is preferred, use `/task-trace id:<prefix>`.
   - Handler should:
     - check `allowedUserId`;
     - defer ephemeral reply;
     - render a short summary in the reply;
     - attach a Markdown file when the trace exceeds Discord content limits.
6. Integrate with incident detail.
   - Add a trace command hint to `formatIncidentDetail` when `subject_type === "task"` and `subject_id` exists.
   - If size permits, optionally include the most severe recent task event summary in incident detail.
   - Avoid duplicating trace formatting in incident code.
7. Add threshold-based trace attachment.
   - Configuration candidate:
     - `tasks.trace_auto_attach.enabled`
     - `tasks.trace_auto_attach.on_failure`
     - `tasks.trace_auto_attach.min_duration_ms`
     - `tasks.trace_auto_attach.min_event_count`
     - `tasks.trace_auto_attach.max_bytes`
   - Start conservative: attach on failed task only, or behind config default false if the behavior is too visible.
   - Hook into final task reporting after `executeTask` knows final status.
8. Add tests.
   - Unit tests for resolver, renderer, redaction, size truncation, and ambiguous id prefix.
   - Handler test for permission and attachment-vs-inline behavior if existing Discord test utilities support it.

## Verification Plan

- Focused tests:
  - `pnpm vitest run src/store/__tests__/task-trace-export.test.ts`
  - `pnpm vitest run src/commands/__tests__/task-log.test.ts` if command tests are added.
  - Existing incident detail test if touched: `pnpm vitest run src/commands/__tests__/incident-detail.test.ts`
- Static checks:
  - `pnpm run typecheck`
  - `pnpm run lint`
- Full regression:
  - `pnpm test`
- Manual local smoke:
  - Run a fake task test or use an existing local DB task id.
  - `pnpm run task:trace -- --id <prefix>`
  - Verify generated Markdown has a timeline and no raw prompt/provider payload.

## Risks And Rollback

- Risk: trace export leaks sensitive data.
  - Mitigation: allowlist payload keys, default truncation, redaction tests, and no raw `payload_json`.
  - Rollback: disable slash command registration and keep CLI local-only until redaction is fixed.
- Risk: trace attachment adds Discord noise.
  - Mitigation: make auto-attach threshold conservative and config-gated.
  - Rollback: turn off `tasks.trace_auto_attach.enabled`.
- Risk: large traces exceed Discord file limits.
  - Mitigation: cap bytes and include a truncation notice.
- Risk: incident detail becomes too long.
  - Mitigation: include command hints, not full traces, in incident detail.

## Documentation Sync

- Update `docs/architecture.md` with the trace exporter and redaction policy.
- Update `docs/bot-routing.md` for the new slash command.
- Update `docs/zh/13-auto-doctor.zh.md` if incident detail links to task trace.
- Update `docs/README.md` if a new feature doc is created.
- Run `pnpm run quality:docs`.

## Execution Notes

Record command name, config defaults, redaction policy, and verification evidence here when implemented.

- 2026-05-12 Ralph phase implemented the direct trace surface:
  - Added `src/store/task-trace-export.ts` with `resolveTaskForTrace`, `buildTaskTraceModel`, `renderTaskTraceMarkdown`, prefix ambiguity errors, no-event errors, chronological event rendering, event limits, UTF-8 byte caps, and `task-<id>-trace.md` filenames.
  - Redaction policy is allowlist-first: raw `payload_json` is never rendered; prompt/raw provider/email/cookie/token/account-like payload keys are omitted; free-text fields are regex-redacted and truncated; omitted payload keys are counted as `redacted_payload_keys`.
  - Added local CLI `pnpm run task:trace -- --id <task-prefix> [--out path] [--json]` via `scripts/task-trace.ts`; no new config defaults were added in this phase.
  - Added Discord slash command `/task-log id:<prefix>` with allowed-user check, ephemeral defer, inline short trace replies, and Markdown attachment for long traces.
  - Added incident detail operator hint `Task trace: /task-log id:<task-prefix>` for task incidents without duplicating trace rendering in incident formatting.
  - Updated `docs/architecture.md` and `docs/bot-routing.md`; `docs/zh/13-auto-doctor.zh.md` was not updated because that file does not exist in this checkout.
  - Remaining plan item: threshold-based automatic trace attachment after task completion is not implemented yet; status stays `draft`.
- Verification evidence:
  - `pnpm vitest run src/store/__tests__/task-trace-export.test.ts src/commands/__tests__/task-log.test.ts src/commands/__tests__/incident-detail.test.ts` passed: 3 files, 11 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run quality:docs` passed: D1 docs drift check, 15 feature docs, schema v8.
  - `pnpm test` passed: 126 files, 626 tests.
  - CLI smoke passed after fixing `pnpm run` separator parsing: `pnpm run task:trace -- --help`.
