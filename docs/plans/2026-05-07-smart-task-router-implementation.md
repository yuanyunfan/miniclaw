# Smart Task Router Implementation

Status: completed
Date: 2026-05-07

## Background

MiniClaw currently routes Discord messages by surface:

- `/task` creates a task thread explicitly.
- `routing.task_channels` turns every ordinary message in configured channels into a task.
- `routing.auto_reply_channels` and mentions enter the lightweight chat path.

This is predictable, but a task-like natural-language prompt sent to a chat-enabled channel enters the read-only chat path. The smart task router described in `docs/archive/features/05-smart-task-router.en.md` should classify eligible messages before chat and either keep chat, suggest task mode, ask for task confirmation, or auto-create a task in trusted channels.

## Goals

- Preserve existing `/task`, task thread resume, task channel, and chat behavior unless smart routing is explicitly enabled.
- Add structured smart-router config under `routing.smart_router`.
- Add explicit per-channel cwd overrides under `routing.channel_defaults`.
- Add a redacted SQLite decision log for route decisions.
- Add deterministic route classification plus required LLM classifier plumbing for ambiguous cases.
- Add Discord buttons for `task_suggest` and `task_confirm`.
- Reuse the same task creation and `executeTask()` flow as `/task`.
- Include bounded untrusted recent chat context only when the prompt clearly references prior context.

## Non-Goals

- Do not merge chat and task permissions.
- Do not persist confirmation state to SQLite in this first version.
- Do not support replying `yes` as confirmation.
- Do not implement OpenClaw-style durable channel/session binding.
- Do not auto-run tasks outside explicitly configured auto-task channels.

## Existing Architecture Evidence

- `src/bot.ts`: owns `MessageCreate` and `InteractionCreate` dispatch.
- `src/commands/handlers.ts`: `/task` creates a thread, writes a task row, sends status embed, and calls `executeTask`.
- `src/agent/task.ts`: task execution, progress updates, final Markdown output.
- `src/agent/chat.ts`: read-oriented chat path and chat history persistence.
- `src/config.ts`: YAML + env layered config, including `routing.auto_reply_channels` and `routing.task_channels`.
- `src/store/db.ts`: SQLite schema and task/chat-history persistence.

## Implementation Plan

1. Add config parsing for smart router settings and channel cwd overrides.
2. Add SQLite table and helpers for `smart_router_decisions`.
3. Add pure routing modules:
   - deterministic heuristic classifier;
   - action resolver;
   - context-reference detector and bounded untrusted context builder;
   - optional LLM-classifier adapter used for ambiguous cases when enabled.
4. Extract task intake creation into a shared Discord helper so `/task`, task channels, auto-upgrade, and confirmed upgrade use one task-start path.
5. Add in-memory confirmation store with 10-minute TTL and Discord button custom ids that only carry a short token/action.
6. Integrate `MessageCreate` smart routing after memory-command handling and before chat.
7. Extend `InteractionCreate` to handle button clicks before slash command dispatch.
8. Update docs and config example to match shipped behavior.

## Verification Plan

- Type check: `pnpm build`.
- Unit tests:
  - `src/routing/__tests__/intent.test.ts`
  - `src/routing/__tests__/context.test.ts`
  - `src/routing/__tests__/confirmations.test.ts`
  - `src/store/__tests__/db.test.ts`
  - `src/__tests__/config.test.ts`
- Broader regression: `pnpm test`.

Manual Discord E2E is intentionally deferred until after the code builds and tests pass:

- normal chat prompt still answers as chat;
- task-like prompt in an eligible chat channel shows buttons;
- `转为 task` creates a task thread;
- `继续 chat` uses the chat path;
- task channel still bypasses smart-router confirmation.

## Risks And Rollback

- Risk: false-positive task routing interrupts normal chat.
  - Mitigation: smart router defaults to disabled, only runs in eligible channels when enabled, and confirmation is required outside auto-task channels.
  - Rollback: disable `routing.smart_router.enabled` and restart.
- Risk: wrong cwd executes a task in the wrong repo.
  - Mitigation: `channel_defaults` is explicit only; `/task cwd` still wins; status embed shows final cwd.
  - Rollback: remove the channel override.
- Risk: button state is lost on restart.
  - Mitigation: confirmation state is intentionally short-lived memory state; expired clicks return an ephemeral message.
  - Rollback: resend the prompt.
- Risk: LLM classifier failure blocks routing.
  - Mitigation: fail closed to deterministic action or chat/suggest and log the failure.

## Documentation Sync

- Update `docs/bot-routing.md` with the actual smart-router path.
- Update `docs/architecture.md` only if the architecture diagram needs a visible routing/config/schema note.
- Update `config.example.yaml` with smart-router and channel-default examples.

## Execution Notes

- Implementation started after reviewing `docs/archive/features/05-smart-task-router.en.md`, `src/bot.ts`, `src/commands/handlers.ts`, `src/config.ts`, and `src/store/db.ts`.
- Added structured smart-router config, explicit channel cwd defaults, SQLite `smart_router_decisions`, deterministic routing, LLM classifier adapter, in-memory confirmation state, shared Discord task intake, and bot message/button integration.
- Focused verification passed:
  - `pnpm build`
  - `pnpm test src/routing/__tests__/intent.test.ts src/routing/__tests__/context.test.ts src/routing/__tests__/confirmations.test.ts src/__tests__/config.test.ts src/store/__tests__/db.test.ts`
- Full regression passed:
  - `pnpm test` — 39 files, 277 tests passed
  - `pnpm build`
