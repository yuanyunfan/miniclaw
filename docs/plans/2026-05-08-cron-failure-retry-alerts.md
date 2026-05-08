# Cron Failure Retry Alerts

Status: completed
Date: 2026-05-08

## Background

MiniClaw cron jobs already retry at the scheduler layer: a failed scheduled run retries up to 5 total attempts with 10m, 20m, 40m, and 80m backoff. The missing piece is visibility in Discord when a scheduled job fails, plus a safe way for the allowed user to retry immediately from that failure message.

## Goals

1. Send a short Discord failure summary when a scheduled cron attempt fails.
2. Include a button that lets the allowed user immediately retry the same failed cron job.
3. Avoid alert spam by editing the same failure message across retry attempts when possible.
4. If an automatic retry later succeeds, edit the failure alert to a recovered state and remove the button.
5. Keep Discord button payloads non-sensitive: only a random run id is stored in the custom id.

## Non-Goals

- Do not expose cron prompt text, provider config, script args, cookies, tokens, account IDs, or raw provider JSON in Discord buttons.
- Do not let Discord users provide arbitrary commands or prompts through the retry button.
- Do not change cron YAML format.
- Do not change runner-specific output behavior beyond scheduler-level failure alerts.

## Existing Architecture Evidence

- `src/cron/scheduler.ts` owns dispatch, retry attempt count, retry delay, and `runningJobs`.
- `src/cron/state.ts` persists `~/.miniclaw/cron/state.json`.
- `src/bot.ts` already handles Discord button interactions for smart router confirmations.
- `docs/quality-gates.md` requires cron scheduler changes to sync `docs/architecture.md`.

## Implementation Plan

1. Extend cron state with failure metadata: attempt counts, next retry time, failure run id, and alert message/channel ids.
2. Add a scheduler-level failure notifier that builds sanitized Discord summaries and retry button components.
3. Replace plain retry sleep with a wakeable retry wait so the button can trigger the next attempt without launching a parallel run.
4. Add a Discord button handler for `miniclaw:cron:retry:<runId>` and enforce `config.allowedUserId`.
5. Update scheduler tests for alert send/edit/recovered behavior and wakeable retries.
6. Update architecture and routing docs.

## Verification Plan

- Unit tests: `pnpm vitest run src/cron/__tests__/scheduler.test.ts src/cron/__tests__/failure-notifier.test.ts src/cron/__tests__/state.test.ts`
- Type check: `pnpm run typecheck`
- Lint: `pnpm run lint`
- Broader push gate if time allows: `pnpm run quality:push`

## Risks And Rollback

- Risk: A failed alert send could mask the original cron failure.
  - Mitigation: notifier errors are caught and logged; cron retry behavior continues.
- Risk: Clicking retry while the job is actively running could create duplicate execution.
  - Mitigation: scheduler only wakes retry backoff or starts a fresh single-attempt run when no current run exists.
- Risk: Error messages might include sensitive text.
  - Mitigation: summarize and sanitize error text, and never include prompt/provider/script config in button ids.
- Rollback: remove the new button handler and failure notifier calls; scheduler retry behavior reverts to current state recording only.

## Documentation Sync

- README: no user-facing setup change required.
- docs: update `docs/architecture.md` cron section and `docs/bot-routing.md` button routing section.
- CHANGELOG: not present.

## Execution Notes

- Added scheduler-level failure alerts with Discord retry buttons.
- Added wakeable retry backoff so immediate retry does not create a parallel run.
- Added `state.json` failure metadata for run id, attempt, next retry, and alert message/channel ids.
- Added cron retry button routing before smart router button routing.
- Verification:
  - `pnpm vitest run src/cron/__tests__/scheduler.test.ts src/cron/__tests__/failure-notifier.test.ts src/cron/__tests__/state.test.ts`
  - `pnpm run typecheck`
  - `pnpm run lint`
  - `pnpm run e2e:cron`
