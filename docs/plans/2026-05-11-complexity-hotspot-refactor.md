# Complexity Hotspot Refactor Plan

Status: draft
Date: 2026-05-11

## Background

`docs/continuous-improvement-report.md` identifies several files where responsibilities have accumulated:

- `src/providers/market-intel/collectors/official.ts`
- `src/agent/task.ts`
- `src/ops/doctor-scheduler.ts`
- `src/bot.ts`
- `src/ops/doctor-repair.ts`
- `src/store/db.ts`
- `src/config.ts`
- `src/ops/doctor.ts`

The problem is not line count alone. The risk is that unrelated concerns share the same file, so future changes by AI agents are more likely to land at the wrong layer, break hidden contracts, or require broad context to review.

This plan is a coordination plan. Do not implement every refactor below in one session. Use it to choose one narrow slice, add or preserve tests, then update execution notes.

## Goals

- Split god modules by stable responsibilities.
- Keep public behavior unchanged during extraction.
- Add focused tests around extracted pure logic.
- Reduce future blast radius for provider, route, repair, task, DB, and config changes.
- Avoid broad formatting churn.

## Non-Goals

- Do not rewrite the whole project architecture.
- Do not combine this with new features unless the feature requires the extraction.
- Do not rename large APIs without a compatibility layer.
- Do not move files just to reduce line count.
- Do not land untested behavior changes hidden inside refactors.

## Existing Architecture Evidence

- `src/bot.ts`: Discord message handling, Smart Router, chat, task channel intake, button routing, slash dispatch.
- `src/agent/task.ts`: active task lifecycle, runners, SDK events, Discord rendering, final output, DB status.
- `src/ops/doctor-scheduler.ts`: scan loop, grouping, notifications, repair trigger policy, scheduler state.
- `src/providers/market-intel/collectors/official.ts`: multiple market data collection and parsing concerns.
- `src/ops/doctor-repair.ts`: policy, prompt build, worktree, agent execution, verification, allowed-path checks, commit/push.
- `src/store/db.ts`: schema creation, migrations, repositories for tasks/chat/router/incidents/events.
- `src/config.ts`: YAML/env loading, validation, path resolution, runtime config, E2E guard, many feature configs.

## Refactor Principles

- Start with pure extraction, not behavior changes.
- Add characterization tests before moving complex branches.
- Preserve exported names where external modules depend on them.
- Use small PR/commit slices.
- Prefer dependency injection for I/O-heavy code after pure logic has been extracted.
- Keep docs and tests aligned after every slice.

## Slice A: `src/bot.ts` Message And Interaction Dispatch

### Target Files

- `src/bot/message-thread-continuation.ts`
- `src/bot/message-task-channel.ts`
- `src/bot/message-chat.ts`
- `src/bot/message-smart-router.ts`
- `src/bot/button-dispatch.ts`
- `src/bot/slash-dispatch.ts`

### Plan

1. Add a `src/bot/` directory while keeping the top-level `src/bot.ts` as the public entry.
2. Extract pure route decision helpers first.
   - Inputs: message metadata, channel ids, thread state, route config.
   - Output: route action enum.
3. Move Smart Router message path into `message-smart-router.ts`.
   - Keep the existing DB logging helpers or inject them.
4. Move task-channel intake into `message-task-channel.ts`.
   - Reuse `src/discord/task-intake.ts`.
5. Move chat path into `message-chat.ts`.
   - Keep permission and E2E author guard behavior unchanged.
6. Move thread continuation into `message-thread-continuation.ts`.
   - Preserve resume/session compatibility checks.
7. Move button routing into `button-dispatch.ts`.
   - Keep cron retry and Smart Router button ordering explicit.
8. Move slash command dispatch into `slash-dispatch.ts`.
   - `src/commands/handlers.ts` remains command implementation.

### Tests

- Add route-decision tests if not already covered.
- Re-run Smart Router, confirmation, and E2E fake runtime tests.

## Slice B: `src/agent/task.ts` Runtime Boundary

Use `2026-05-11-task-view-boundary.md` as the detailed implementation plan.

Keep this slice separate because it affects task cancellation, provider streaming, Discord output, and DB persistence.

## Slice C: `src/ops/doctor-scheduler.ts` Doctor Scheduler Split

### Target Files

- `src/ops/doctor-scheduler/scan-loop.ts`
- `src/ops/doctor-scheduler/grouping.ts`
- `src/ops/doctor-scheduler/notifications.ts`
- `src/ops/doctor-scheduler/repair-policy.ts`
- `src/ops/doctor-scheduler/state.ts`

### Plan

1. Extract incident grouping as pure functions.
2. Extract notification formatting from Discord send side effects.
3. Extract repair scheduling/rate-limit policy from the scan loop.
4. Keep the public `startDoctorScheduler()` or equivalent entry stable.
5. Add tests around grouping, notification text, and repair skip reasons.

### Tests

- `pnpm vitest run src/ops/__tests__/doctor-scheduler*.test.ts`
- Add new tests for extracted modules.

## Slice D: `src/providers/market-intel/collectors/official.ts`

### Target Files

- `src/providers/market-intel/collectors/calendar.ts`
- `src/providers/market-intel/collectors/news.ts`
- `src/providers/market-intel/collectors/events.ts`
- `src/providers/market-intel/collectors/quotes.ts`
- `src/providers/market-intel/collectors/macro.ts`
- `src/providers/market-intel/collectors/scoring-input.ts`
- `src/providers/market-intel/collectors/parsers/*.ts`

### Plan

1. Add fixture tests for current collector output using stable static fixture data.
2. Extract source-specific parsers first.
3. Extract collector orchestration second.
4. Keep exported collector API unchanged until tests prove parity.
5. Add redaction/staleness checks per source if not already present.

### Tests

- `pnpm vitest run src/providers/market-intel`
- Add parser fixture tests before moving network-facing code.

## Slice E: `src/ops/doctor-repair.ts`

### Target Files

- `src/ops/doctor-repair/policy.ts`
- `src/ops/doctor-repair/prompt.ts`
- `src/ops/doctor-repair/worktree.ts`
- `src/ops/doctor-repair/verification.ts`
- `src/ops/doctor-repair/path-policy.ts`
- `src/ops/doctor-repair/report.ts`

### Plan

1. Extract repair policy and path policy as pure modules.
2. Extract repair prompt builder and add snapshot-style tests.
3. Extract verification command runner wrapper.
4. Extract worktree/branch operations behind an interface.
5. Keep `scripts/doctor-repair.ts` CLI behavior unchanged.

### Tests

- Existing `src/ops/__tests__/doctor-repair*.test.ts` if present.
- Add unit tests for policy, prompt, and path allowlist.

## Slice F: `src/store/db.ts`

Use `2026-05-11-db-migrations-state-lifecycle.md` as the detailed implementation plan.

Do not mix DB migration extraction with unrelated schema additions unless the schema addition is the pilot migration.

## Slice G: `src/config.ts`

Use `2026-05-11-config-schema-first.md` as the detailed implementation plan.

Config refactor should preserve `import { config } from "../config.js"` during the first slice.

## Implementation Plan

1. Pick one slice before coding.
2. Identify public exports and current tests.
3. Add a minimal characterization test if the behavior is not already covered.
4. Extract pure functions or side-effect boundaries.
5. Keep old entry file as facade where possible.
6. Run focused tests and static gates.
7. Update docs and this plan's execution notes.

## Verification Plan

Baseline for every slice:

- `pnpm run typecheck`
- `pnpm run lint`
- Focused `pnpm vitest run ...`

When the slice touches runtime output:

- `pnpm run build`
- Relevant E2E fake/fixture command, such as `pnpm run e2e:cron` or focused fake runtime tests.

When the slice touches docs/source-of-truth behavior:

- `pnpm run quality:docs`

## Risks And Rollback

- Risk: behavior changes are hidden inside extraction.
  - Mitigation: add characterization tests and preserve public API.
  - Rollback: revert the slice commit; do not partially keep moved code if tests fail.
- Risk: conflicts with other plans.
  - Mitigation: do Task runtime, DB, and config through their dedicated plans.
- Risk: imports churn across the repo.
  - Mitigation: keep facade files and re-export old names during transition.
- Risk: large refactor becomes unrecoverable.
  - Mitigation: one module family per commit.

## Documentation Sync

- Update `docs/architecture.md` when module boundaries change.
- Update `docs/bot-routing.md` for bot routing extraction only if behavior or dispatch order changes.
- Update `docs/quality-gates.md` if new tests/gates are added.
- Keep plan docs as execution records, not permanent behavior source of truth.

## Execution Notes

For each completed slice, record:

- slice name
- changed files
- behavior parity tests
- any public API changes
- follow-up cleanup

### 2026-05-12 - Slice A Interaction Dispatch Extraction

- Slice name: Slice A partial, interaction dispatch boundary.
- Changed files:
  - `src/bot.ts`: kept `createBot()` and MessageCreate flow as the public entry, delegated button and slash interactions to `src/bot/*`.
  - `src/bot/message-smart-router.ts`: extracted smart router decision logging, task prompt context building, and confirmation prompt/button construction.
  - `src/bot/button-dispatch.ts`: extracted cron retry + smart router button dispatch order and shared button error reply behavior.
  - `src/bot/slash-dispatch.ts`: extracted slash command name to `commands/handlers.ts` mapping and shared command error reply behavior.
  - `src/bot/__tests__/button-dispatch.test.ts`: added characterization tests for cron-before-smart-router ordering, unclaimed buttons, and button error replies.
  - `src/bot/__tests__/slash-dispatch.test.ts`: added characterization tests for handler routing, unknown command reply, and pre/post-defer error replies.
  - `docs/bot-routing.md`, `docs/architecture.md`: documented the new bot dispatch module boundary and updated slash/button extension guidance.
- Behavior parity tests:
  - `pnpm vitest run src/bot/__tests__/button-dispatch.test.ts src/bot/__tests__/slash-dispatch.test.ts src/routing/__tests__/message-route.test.ts` passed, 15 tests.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard` passed: `pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
  - `pnpm run build` passed.
- Public API changes: none. `createBot()` remains exported from `src/bot.ts`; interaction order remains cron retry button, smart router button, then slash command.
- Follow-up cleanup: MessageCreate chat/task/thread paths still live in `src/bot.ts`; future Slice A phases can extract `message-task-channel.ts`, `message-chat.ts`, and `message-thread-continuation.ts` with focused tests.
