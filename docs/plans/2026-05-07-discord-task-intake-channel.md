# Discord Task Intake Channel

Status: completed
Date: 2026-05-07

## Background

The user wants a dedicated Discord channel where MiniClaw receives task requests without needing `@MiniClaw`.

Current behavior:

- `MINICLAW_AUTO_REPLY_CHANNELS` only enables no-mention chat replies.
- `/task` creates an isolated thread and runs `executeTask()`.
- Message replies inside an existing task thread resume that task session.

This means simply adding a channel to `MINICLAW_AUTO_REPLY_CHANNELS` would route messages to chat, not task execution.

## Goals

- Create a Discord text channel dedicated to MiniClaw task intake.
- Add config for no-mention task intake channels.
- Messages sent in that channel should create a task thread and run `executeTask()`.
- Preserve existing `/task`, thread continuation, and chat auto-reply behavior.
- Avoid escalating all auto-reply chat channels into task channels.

## Non-Goals

- Do not remove `/task`.
- Do not change cron execution.
- Do not allow other Discord users to trigger tasks.
- Do not change provider selection, sandbox, or model behavior.

## Existing Architecture Evidence

- `src/bot.ts`: message routing, thread continuation, auto-reply chat path.
- `src/commands/handlers.ts`: `/task` creates a public thread and calls `executeTask()`.
- `src/config.ts`: parses `MINICLAW_AUTO_REPLY_CHANNELS`.
- `src/discord/attachments.ts`: shared attachment handling for chat and task.
- `src/agent/task.ts`: cleans task attachment directories in `finally`.

## Implementation Plan

1. Add `MINICLAW_TASK_CHANNELS` config as comma-separated Discord channel IDs.
2. In `MessageCreate`, after thread continuation and before chat auto-reply, route messages from task channels into a new task.
3. For each task-channel message:
   - enforce allowed user and max concurrency;
   - use message content or attachments as task prompt;
   - create a public thread from the message;
   - create a task DB row;
   - send the task start embed;
   - run `executeTask()` in the thread.
4. Update `.env.example`, README, English README, architecture docs, bot routing docs, and changelog.
5. Create the Discord channel and add its ID to the local `.env`.
6. Rebuild and restart MiniClaw.
7. Trigger one smoke test message in the new channel and verify task creation/output.

## Verification Plan

- Type check: `pnpm build`.
- Unit tests: run targeted tests if any config/router helper is extracted; otherwise rely on type check plus live smoke test.
- Manual/E2E:
  - create channel in Discord;
  - send one message without mention;
  - confirm MiniClaw creates a thread;
  - confirm DB task status becomes completed;
  - confirm Discord output uses the normal task status/progress/final Markdown structure.

## Risks And Rollback

- Risk: a channel accidentally listed in both chat auto-reply and task channels.
  - Mitigation: task channel check runs before chat auto-reply; document that task wins.
- Risk: a casual message in the task channel starts an expensive task.
  - Mitigation: dedicated channel name and existing `MINICLAW_ALLOWED_USER_ID` gate.
- Risk: attachment processing fails before task creation.
  - Mitigation: reply with an error and do not create the task row.
- Rollback: remove the new channel ID from `MINICLAW_TASK_CHANNELS`, restart MiniClaw, and optionally delete the Discord channel.

## Documentation Sync

- README: add task channel config and behavior.
- README.en.md: same in English.
- docs/architecture.md: add task channel branch.
- docs/bot-routing.md: add routing path.
- CHANGELOG.md: record the feature.

## Execution Notes

- Added `MINICLAW_TASK_CHANNELS` and routed matching `MessageCreate` events to task thread creation before chat auto-reply routing.
- Created Discord channel `#task` under the existing AI category.
- Added the task channel ID to local `MINICLAW_TASK_CHANNELS` and restarted PM2 with `--update-env`.
- Smoke test message in `#task` created a task and a task thread.
- Smoke test completed through Codex with `tools=0`, duration `26.8s`, and final Discord output confirming that the task channel worked.
- Verification commands passed: `pnpm build`, targeted vitest for attachments/formatter/task helpers, and `git diff --check`.
