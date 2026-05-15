# Complexity Hotspot Refactor Plan

Status: done
Date: 2026-05-11

## Background

`docs/archive/2026-05-11-continuous-improvement-report.md` identifies several files where responsibilities have accumulated:

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

### 2026-05-12 - Slice A MessageCreate Dispatch Extraction

- Slice name: Slice A completion, MessageCreate dispatch boundary.
- Changed files:
  - `src/bot.ts`: kept `createBot()` as the public Discord client entry, retained route calculation/draining guard/client-ready recovery, and delegated MessageCreate business paths to `src/bot/*`.
  - `src/bot/message-thread-continuation.ts`: extracted task thread resume/session compatibility guard, follow-up attachment handling, task row creation, reporter events, and `executeTask(... resumeSessionId ...)` wiring.
  - `src/bot/message-task-channel.ts`: extracted dedicated task channel intake, bot mention stripping, capacity check, task context capture, and shared `createAndRunDiscordTask()` call.
  - `src/bot/message-chat.ts`: extracted chat route prechecks, explicit memory short-circuit, smart router auto/confirm/chat routing, attachment cleanup, typing/progress callbacks, and chat error formatting.
  - `src/bot/__tests__/message-task-channel.test.ts`, `src/bot/__tests__/message-chat.test.ts`, `src/bot/__tests__/message-thread-continuation.test.ts`: added focused characterization tests for the extracted message handlers.
  - `docs/bot-routing.md`, `docs/architecture.md`, `docs/chat-router-current-logic.md`: updated bot dispatch boundary documentation to point at the extracted MessageCreate modules.
- Behavior parity tests:
  - `pnpm vitest run src/bot/__tests__/message-task-channel.test.ts src/bot/__tests__/message-chat.test.ts src/bot/__tests__/message-thread-continuation.test.ts src/bot/__tests__/button-dispatch.test.ts src/bot/__tests__/slash-dispatch.test.ts src/routing/__tests__/message-route.test.ts` passed, 23 tests.
  - `pnpm vitest run src/routing/__tests__/intent.test.ts src/routing/__tests__/confirmations.test.ts src/agent/__tests__/e2e-fake-runtime.test.ts` passed, 31 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run build` passed.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard` passed: `pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- Public API changes: none. `createBot()` remains exported from `src/bot.ts`; message route order remains ignore/draining/thread continuation/task channel/chat, and interaction order remains unchanged.
- Follow-up cleanup: Slice A is now extracted enough for future changes to happen inside path-specific modules. Remaining complexity-hotspot work should move to another slice from this plan, not continue broadening `src/bot.ts`.

### 2026-05-12 - Slice C Doctor Scheduler Split

- Slice name: Slice C completion, doctor scheduler state/grouping/notification/repair-policy boundary.
- Changed files:
  - `src/ops/doctor-scheduler.ts`: kept `createDoctorScheduler()` and `startDoctorScheduler()` as the public scheduler entry, retained scan-loop DB writes, notification event writes, repair invocation, and dependency injection wiring.
  - `src/ops/doctor-scheduler/state.ts`: extracted MiniClaw log fingerprint calculation plus running/fingerprint scheduler state.
  - `src/ops/doctor-scheduler/grouping.ts`: extracted pure notification grouping, diagnosis/source helpers, problem-text selection, and normalized signature generation.
  - `src/ops/doctor-scheduler/notifications.ts`: extracted single/group/digest incident notification text, repair notification text, and Discord summary-channel delivery.
  - `src/ops/doctor-scheduler/repair-policy.ts`: extracted repair eligibility, UTC day bucket, and parallel/daily repair rate-limit skip decisions.
  - `src/ops/__tests__/doctor-scheduler-boundaries.test.ts`: added direct tests for grouping normalization, notification text through the extracted formatter, repair policy skip reasons, and scheduler state behavior.
  - `docs/architecture.md`, `docs/features/13-auto-doctor.md`: documented the new Auto Doctor scheduler module boundary.
- Behavior parity tests:
  - `pnpm vitest run src/ops/__tests__/doctor-scheduler*.test.ts` passed, 12 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run build` passed.
  - `pnpm run quality:docs` passed.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard` passed: `pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- Public API changes: none. `createDoctorScheduler()`, `startDoctorScheduler()`, `DoctorNotificationGroup`, `DoctorNotificationItem`, and repair skip types remain exported from `src/ops/doctor-scheduler.ts`.
- Follow-up cleanup: Remaining complexity-hotspot work should move to Slice D/E/F/G; `doctor-scheduler.ts` now keeps the scan orchestration boundary and should not regain notification formatting or policy helpers.

### 2026-05-12 - Slice D Official Parser Extraction

- Slice name: Slice D partial, source-specific parser boundary.
- Changed files:
  - `src/providers/market-intel/collectors/official.ts`: kept `collectMarketIntelOfficialEvidence()` and source status/warning orchestration stable, delegated Treasury/BLS/Fed/SEC/SSE/SZSE/HKEX/PBOC/NBS parsing to `collectors/parsers/*`.
  - `src/providers/market-intel/collectors/parsers/shared.ts`: extracted pure record/string/date/freshness/HTML-link parsing helpers.
  - `src/providers/market-intel/collectors/parsers/macro.ts`: extracted Treasury XML, BLS JSON, and Federal Reserve RSS parser logic plus BLS series ids.
  - `src/providers/market-intel/collectors/parsers/filings.ts`: extracted SEC ticker/submission parsing, JSONP parsing, and SSE/SZSE/HKEX announcement parsers.
  - `src/providers/market-intel/collectors/parsers/risk.ts`: extracted derived risk keyword classification.
  - `src/providers/market-intel/__tests__/official-parsers.test.ts`: added fixture tests for macro, SEC, exchange announcement, dated HTML, and risk parser behavior.
  - `docs/architecture.md`, `docs/features/14-market-intel-provider.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: documented the parser/orchestration boundary and updated remaining hotspot status.
- Behavior parity tests:
  - `pnpm vitest run src/providers/market-intel/__tests__/official-parsers.test.ts src/providers/market-intel/__tests__/official-collectors.test.ts` passed, 7 tests.
  - `pnpm vitest run src/providers/market-intel` passed, 27 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run quality:docs` passed.
  - `pnpm run build` passed.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard` passed: `pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- Public API changes: none. `MarketIntelOfficialHttpClient`, `buildEmptyMarketIntelEvidenceCollection()`, and `collectMarketIntelOfficialEvidence()` remain exported from `src/providers/market-intel/collectors/official.ts`.
- Follow-up cleanup: Continue Slice D by splitting `official.ts` orchestration by source family, then move remaining Slice E/F/G hotspots through their dedicated plans.

### 2026-05-12 - Slice D Official Source-Family Orchestration Extraction

- Slice name: Slice D completion, official source-family collector boundary.
- Changed files:
  - `src/providers/market-intel/collectors/official.ts`: reduced to the public facade for `collectMarketIntelOfficialEvidence()`, `MarketIntelOfficialHttpClient`, and `buildEmptyMarketIntelEvidenceCollection()`, with market-scope fan-out only.
  - `src/providers/market-intel/collectors/macro.ts`: extracted Treasury/BLS/PBOC/NBS endpoint orchestration and macro source status/warning behavior.
  - `src/providers/market-intel/collectors/news.ts`: extracted Federal Reserve RSS endpoint orchestration.
  - `src/providers/market-intel/collectors/events.ts`: extracted SEC EDGAR plus SSE/SZSE/HKEX announcement endpoint orchestration.
  - `src/providers/market-intel/collectors/scoring-input.ts`: extracted evidence section assembly, dedupe, earnings/filings split, derived risk evidence, and empty collection construction.
  - `src/providers/market-intel/collectors/official-http.ts`, `src/providers/market-intel/collectors/official-shared.ts`: extracted fetch-backed HTTP client, shared source/result helpers, failure redaction, and section helpers.
  - `src/providers/market-intel/__tests__/official-collectors.test.ts`: added direct characterization coverage for independently callable macro/news/events source-family collectors.
  - `docs/architecture.md`, `docs/features/14-market-intel-provider.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: documented the new official evidence facade/source-family/scoring-input boundary and updated current hotspot status.
- Behavior parity tests:
  - `pnpm vitest run src/providers/market-intel/__tests__/official-collectors.test.ts src/providers/market-intel/__tests__/official-parsers.test.ts` passed, 8 tests.
  - `pnpm vitest run src/providers/market-intel` passed, 28 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run quality:docs` passed.
  - `pnpm run build` passed.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard` passed: `pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- Public API changes: none. Existing imports from `src/providers/market-intel/collectors/official.ts` remain valid.
- Follow-up cleanup: Slice D is now complete enough that new official market-intel sources should land in source-family collector modules plus parser fixtures, not in the facade. Remaining complexity-hotspot work should move to Slice E/F/G.

### 2026-05-12 - Slice E Doctor Repair Pure Boundary Extraction

- Slice name: Slice E partial, repair policy/path/prompt/verification boundary.
- Changed files:
  - `src/ops/doctor-repair.ts`: kept `runDoctorRepair()`, CLI args, result formatting, worktree/agent/commit/push orchestration, and compatibility exports as the public repair facade.
  - `src/ops/doctor-repair/policy.ts`: extracted repair eligibility gates and force/config handling as a config-free pure policy module.
  - `src/ops/doctor-repair/path-policy.ts`: extracted git porcelain changed-file parsing plus allowed/blocked glob path validation.
  - `src/ops/doctor-repair/prompt.ts`: extracted repair worker prompt rendering with injected allowed/blocked path policy.
  - `src/ops/doctor-repair/verification.ts`: extracted targeted test selection, standard verification command list, and command runner loop.
  - `src/ops/__tests__/doctor-repair-boundaries.test.ts`: added focused characterization tests for the extracted policy, path, prompt, and verification boundaries.
  - `docs/features/13-auto-doctor.md`, `docs/architecture.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: documented the new guarded repair module boundary and updated hotspot status.
- Behavior parity tests:
  - `pnpm vitest run src/ops/__tests__/doctor-repair.test.ts src/ops/__tests__/doctor-repair-boundaries.test.ts` passed, 17 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run build` passed; generated ignored `dist/` artifacts were removed after verification.
  - `pnpm run quality:docs` passed.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard` passed: `pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- Public API changes: none for existing consumers. Existing imports from `src/ops/doctor-repair.ts` for policy, path validation, targeted test selection, repair execution, and formatting remain valid.
- Follow-up cleanup: Continue Slice E by extracting worktree/branch operations, Codex repair agent execution, commit/push helpers, and report formatting from the orchestration shell.

### 2026-05-12 - Slice E Doctor Repair Execution Boundary Extraction

- Slice name: Slice E completion, repair worktree/agent/report boundary.
- Changed files:
  - `src/ops/doctor-repair.ts`: kept `runDoctorRepair()`, CLI args, compatibility exports, incident status transitions, repair_run updates, and high-level repair orchestration as the public facade.
  - `src/ops/doctor-repair/worktree.ts`: extracted default command runner, repair id sanitization, worktree path/branch derivation, worktree preparation, dependency install guard, current SHA lookup, repair commit message, verified commit, and isolated branch push helpers.
  - `src/ops/doctor-repair/agent.ts`: extracted Codex repair agent streaming, timeout handling, agent response capture, tool log capture, and agent failure mapping.
  - `src/ops/doctor-repair/report.ts`: extracted CLI/report formatting for dry-run, policy, changed files, verification, commit, and push status output.
  - `src/ops/__tests__/doctor-repair-boundaries.test.ts`: added focused tests for sanitized worktree targets, worktree creation/reuse command routing, commit/push command routing, and report formatting.
  - `docs/architecture.md`, `docs/features/13-auto-doctor.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: documented the completed guarded repair module boundary and updated hotspot status.
- Behavior parity tests:
  - `pnpm vitest run src/ops/__tests__/doctor-repair.test.ts src/ops/__tests__/doctor-repair-boundaries.test.ts` passed, 21 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run build` passed.
  - `pnpm run quality:docs` passed.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard` passed: `pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- Public API changes: none for existing consumers. `runDoctorRepair()`, `parseDoctorRepairArgs()`, `evaluateRepairPolicy()`, `validateChangedPaths()`, `selectTargetedTestCommands()`, `formatDoctorRepairResult()`, and related facade type exports remain available from `src/ops/doctor-repair.ts`.
- Follow-up cleanup: Slice E is now complete enough that new repair policy, Git/worktree behavior, agent streaming behavior, verification rules, and report text should land in the extracted modules with focused tests. Remaining complexity-hotspot work should move to Slice F/G or the next explicitly selected hotspot rather than broadening `src/ops/doctor-repair.ts`.

### 2026-05-12 - Slice F DB Migration Boundary Extraction

- Slice name: Slice F partial, schema/migration/audit boundary.
- Changed files:
  - `src/store/db.ts`: kept the public DB facade, connection init, task/chat/Smart Router helpers, `SCHEMA_VERSION` re-export, and compatibility `__testables`; delegated base schema creation and migration execution to `src/store/schema.ts`.
  - `src/store/schema.ts`: added `SCHEMA_VERSION = 10`, `ensureBaseSchema()`, `runMigrations()`, schema version inspection, and `listSchemaVersionHistory()`.
  - `src/store/migrations/*`: extracted current v1-v10 schema migrations into versioned migration modules plus shared column/history helpers.
  - `src/store/__tests__/migrations.test.ts`: added in-memory SQLite tests for new DB migration history, legacy v4-to-current upgrades, idempotent reruns, and failed migration rollback behavior.
  - `src/store/__tests__/db.test.ts`: covered the facade-level schema history table and history rows.
  - `scripts/quality-docs.ts`, `docs/architecture.md`, `docs/quality-gates.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: moved schema-version source-of-truth to `src/store/schema.ts`, documented `schema_version_history`, and updated the remaining hotspot status.
- Behavior parity tests:
  - `pnpm vitest run src/store/__tests__/migrations.test.ts src/store/__tests__/db.test.ts` passed, 24 tests.
  - `pnpm vitest run src/store` passed, 43 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run quality:docs` passed with schema v10.
  - `pnpm test` passed, 137 files / 684 tests.
  - `pnpm run build` passed; generated ignored `dist/` artifacts were removed after verification.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard` passed: `pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- Public API changes: existing imports from `src/store/db.ts` remain valid, including `SCHEMA_VERSION`; new diagnostic helper `listSchemaVersionHistory()` is exported from the facade. SQLite schema version bumped from 9 to 10 for `schema_version_history`.
- Follow-up cleanup: continue Slice F by splitting `tasks`, `chat_history`, and `smart_router_decisions` repository helpers out of `src/store/db.ts`; retention config, cleanup command, and shared diagnostic redaction policy remain future phases.

### 2026-05-12 - Slice F DB Repository Boundary Extraction

- Slice name: Slice F partial, connection and task/chat/Smart Router repository boundary.
- Changed files:
  - `src/store/db.ts`: reduced to DB init/schema facade, compatibility re-exports, and Stage scene helpers; existing imports from `src/store/db.ts` remain valid.
  - `src/store/connection.ts`: added the shared live SQLite handle used by store modules.
  - `src/store/repositories/tasks.ts`: extracted task row types, task creation, updates, lookup helpers, active/interrupted/recent listings, and Smart Router outcome writeback wiring.
  - `src/store/repositories/chat-history.ts`: extracted chat history append/list helpers.
  - `src/store/repositories/smart-router-decisions.ts`: extracted Smart Router decision/review types and decision logging, user choice, outcome, recent, and review helpers.
  - `src/store/task-events.ts`, `src/store/incidents.ts`, `src/store/market-forecasts.ts`: switched existing split store modules to depend on `src/store/connection.ts` instead of the public DB facade.
  - `src/store/__tests__/db.test.ts`: added direct repository characterization coverage for task status -> Smart Router outcome linkage and per-channel chat history ordering.
  - `docs/architecture.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: documented the connection/repository boundary and updated remaining hotspot status.
- Behavior parity tests:
  - `pnpm vitest run src/store/__tests__/db.test.ts` passed, 22 tests.
  - `pnpm vitest run src/store/__tests__/migrations.test.ts src/store/__tests__/db.test.ts` passed, 26 tests.
  - `pnpm vitest run src/store` passed, 45 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run quality:docs` passed with schema v10.
  - `pnpm run build` passed; generated ignored `dist/` artifacts were removed after verification.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard` passed: `pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- Public API changes: none for initialized store usage. `getDb()`, task helpers, chat helpers, and Smart Router helpers continue to be re-exported from `src/store/db.ts`.
- Follow-up cleanup: retention config, dry-run cleanup command, and shared diagnostic redaction policy remain future Slice F work; broader config work belongs to Slice G.

### 2026-05-12 - Slice F DB State Retention Cleanup Boundary

- Slice name: Slice F partial, state retention cleanup boundary.
- Changed files:
  - `src/store/state-cleanup.ts`: added cleanup target planning plus dry-run savepoint simulation and transaction-backed execute behavior for `chat_history`, `task_events`, `smart_router_decisions`, incidents/incident events, repair runs, and market forecasts.
  - `scripts/state-cleanup.ts`, `package.json`: added `pnpm run state:cleanup -- [--dry-run | --execute] [--table <scope>] [--older-than-days <n>]`.
  - `src/config.ts`, `src/__tests__/config.test.ts`, `config.example.yaml`: added `state.retention.*` defaults and env override coverage.
  - `src/store/__tests__/state-cleanup.test.ts`: added focused tests for dry-run rollback, single-scope cleanup, market forecast child-before-parent deletion, and closed incident cleanup safety.
  - `docs/architecture.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`, `docs/plans/2026-05-11-db-migrations-state-lifecycle.md`: documented the cleanup boundary, defaults, and remaining redaction-policy gap.
- Behavior parity tests:
  - `pnpm vitest run src/store/__tests__/state-cleanup.test.ts` passed, 6 tests.
  - `pnpm vitest run src/__tests__/config.test.ts` passed, 17 tests.
  - `pnpm vitest run src/store` passed, 7 files / 51 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run quality:docs` passed with schema v10.
  - `pnpm run build` passed; generated ignored `dist/` artifacts were removed after verification.
  - Temp DB smoke `pnpm run state:cleanup -- --dry-run --table task_events --older-than-days 30` passed with 0 candidates against `/private/tmp/miniclaw-state-cleanup-smoke.db`; temp DB artifacts were removed after verification.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard` passed: `pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- Public API changes: none for existing DB facade consumers. New state cleanup helpers are direct imports from `src/store/state-cleanup.ts`; the CLI defaults to dry-run.
- Follow-up cleanup: shared diagnostic redaction policy remains future Slice F work; broader schema-first config split still belongs to Slice G.

### 2026-05-12 - Slice F Shared Diagnostic Redaction Boundary

- Slice name: Slice F completion, shared diagnostic redaction policy boundary.
- Changed files:
  - `src/privacy/diagnostic-redaction.ts`: added shared diagnostic redaction helpers for credential text, raw prompt/body/provider payload fields, email/phone text, and hashed session/account identifiers.
  - `src/store/task-trace-export.ts`: replaced task-trace-local redaction regex with the shared policy and redacted exported task/session ids while preserving allowlist payload projection and `redacted_payload_keys`.
  - `src/commands/incident-detail.ts`: routed incident summary/source/diagnosis values, task trace snippets, repair paths, and event payload rendering through shared diagnostic redaction.
  - `src/commands/task-log.ts`, `src/discord/task-trace-attachment.ts`: updated safety copy to mention session/account redaction.
  - `src/privacy/__tests__/diagnostic-redaction.test.ts`, `src/store/__tests__/task-trace-export.test.ts`, `src/commands/__tests__/incident-detail.test.ts`: added focused redaction coverage.
  - `docs/architecture.md`, `docs/features/03-discord-task-output.md`, `docs/features/13-auto-doctor.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`, `docs/plans/2026-05-11-db-migrations-state-lifecycle.md`: documented the shared diagnostic redaction boundary and marked the DB lifecycle sub-plan done.
- Behavior parity tests:
  - `pnpm vitest run src/privacy/__tests__/diagnostic-redaction.test.ts src/store/__tests__/task-trace-export.test.ts src/commands/__tests__/incident-detail.test.ts` passed, 12 tests.
  - `pnpm vitest run src/commands/__tests__/task-log.test.ts src/discord/__tests__/task-view-reporter.test.ts` passed, 11 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run quality:docs` passed with schema v10.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard` passed: `pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- Public API changes: no function signature changes. Task trace exported models/Markdown now redact raw session ids as hashed identifiers.
- Follow-up cleanup: Slice F is now complete. Remaining complexity-hotspot work should move to Slice G config schema-first refactor or another explicitly selected hotspot; future provider dry-run/diagnostic bundles should reuse `src/privacy/diagnostic-redaction.ts`.

### 2026-05-12 - Slice G Config Load/Env/Resolve/E2E Boundary Extraction

- Slice name: Slice G partial, config facade and pure boundary extraction.
- Changed files:
  - `src/config.ts`: reduced to compatibility facade re-exporting `src/config/index.ts`.
  - `src/config/index.ts`: kept runtime config assembly, `config`, `assertE2eSafeRuntimePath()`, public type re-exports, process env base URL side effects, and current YAML/env/default behavior.
  - `src/config/load.ts`: extracted YAML file loading, default config path behavior, explicit missing config errors, and raw object schema validation handoff.
  - `src/config/env.ts`: extracted env precedence, raw config path reads, scalar/boolean/number/list parsing, enum/inherit parsing, and unlimited budget/turn parsing.
  - `src/config/schema.ts`: added Zod-backed raw object schema plus shared enum value constants.
  - `src/config/resolve.ts`: extracted `~` path resolution and `routing.channel_defaults.*.cwd` resolution.
  - `src/config/e2e-guard.ts`: extracted pure E2E temp-dir isolation checks.
  - `src/config/types.ts`: moved public config type aliases and `SmtpEmailNotificationConfig`.
  - `src/config/__tests__/config-boundaries.test.ts`: added focused tests for load/env/resolve/schema/E2E guard boundaries.
  - `src/quality/docs-drift.ts`, `src/quality/__tests__/docs-drift.test.ts`, `docs/quality-gates.md`: extended docs drift mapping to cover future `src/config/**` changes.
  - `docs/architecture.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`, `docs/plans/2026-05-11-config-schema-first.md`: documented the new boundary and remaining runtime assembly work.
- Behavior parity tests:
  - `pnpm vitest run src/quality/__tests__/docs-drift.test.ts src/config/__tests__/config-boundaries.test.ts src/__tests__/config.test.ts src/e2e/__tests__/safety.test.ts` passed, 36 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run quality:docs` passed.
  - `pnpm run build` passed; generated ignored `dist/` artifacts were removed after verification.
- Public API changes: none. Existing `import { config } from "../config.js"` call sites remain valid, and no user-facing config fields/env keys changed.
- Follow-up cleanup: continue Slice G by splitting `src/config/index.ts` into domain runtime builders, adding deeper domain schemas, and freezing the final runtime config object after mutation-prone tests are migrated.

### 2026-05-12 - Slice G Config Runtime Domain Builder Extraction

- Slice name: Slice G completion, config runtime/domain-builder boundary.
- Changed files:
  - `src/config/index.ts`: reduced to public exports and the existing proxy side-effect import.
  - `src/config/runtime.ts`: added runtime composition, `createRuntimeConfig()`, `config`, provider base URL env side-effect preservation, auto-reply warning, final E2E cross-field validation, and runtime deep-freeze.
  - `src/config/domains/agent.ts`, `routing.ts`, `storage.ts`, `tasks.ts`, `operations.ts`, `attachments.ts`, `providers.ts`, `e2e.ts`, `mcp.ts`: split domain defaults, YAML paths, env key mapping, enum/typed validators, and path resolution out of the runtime facade.
  - `src/config/__tests__/config-boundaries.test.ts`: added direct runtime composition and deep-freeze tests without importing the singleton config facade.
  - `docs/architecture.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`, `docs/plans/2026-05-11-config-schema-first.md`: documented the completed config runtime boundary and updated remaining hotspot status.
- Behavior parity tests:
  - `pnpm vitest run src/config/__tests__/config-boundaries.test.ts src/__tests__/config.test.ts src/e2e/__tests__/safety.test.ts` passed, 28 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run quality:docs` passed with schema v10.
  - `pnpm run build` passed; generated ignored `dist/` artifacts were removed after verification.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard` passed: `pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- Public API changes: none. Existing imports from `src/config.ts` / `../config.js` remain valid; no user-facing YAML/env key shape changed. Runtime config is frozen at runtime while preserving the prior public TypeScript shape for compatibility.
- Follow-up cleanup: Slice G is complete. Remaining complexity-hotspot work should move to `src/ops/doctor.ts` or a separate explicit hotspot plan rather than adding config assembly back to `src/config/index.ts`.

### 2026-05-12 - Final Hotspot Auto Doctor Diagnosis Boundary

- Slice name: final complexity hotspot, read-only doctor diagnosis/evidence/report boundary. This closes the remaining `src/ops/doctor.ts` hotspot from the original background list; Slice B task runtime was completed in `docs/plans/2026-05-11-task-view-boundary.md`.
- Changed files:
  - `src/ops/doctor.ts`: reduced to the public facade for `runDoctor()`, `parseDoctorArgs()`, `formatDoctorReport()`, `redactSensitive()`, and doctor type exports.
  - `src/ops/doctor/types.ts`: moved public doctor mode, evidence, diagnosis, report, args, command runner, and run options types.
  - `src/ops/doctor/args.ts`: extracted CLI flag parsing and `~` path resolution.
  - `src/ops/doctor/evidence.ts`: extracted read-only SQLite task/task_events, cron state, connectivity state, PM2, Git, and log evidence collection.
  - `src/ops/doctor/diagnosis.ts`: extracted incident type, severity, category, repair eligibility, evidence summary, and next-action classification.
  - `src/ops/doctor/report.ts`: extracted CLI text report formatting.
  - `src/ops/doctor/redaction.ts`: extracted doctor-local redaction and value normalization helpers.
  - `src/ops/__tests__/doctor-boundaries.test.ts`: added direct tests for diagnosis, report formatting, and doctor redaction boundaries.
  - `docs/architecture.md`, `docs/features/13-auto-doctor.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: documented the final read-only doctor module boundary and updated remaining hotspot status.
- Behavior parity tests:
  - `pnpm vitest run src/ops/__tests__/doctor.test.ts src/ops/__tests__/doctor-boundaries.test.ts` passed, 10 tests.
  - `pnpm vitest run src/ops/__tests__/doctor.test.ts src/ops/__tests__/doctor-boundaries.test.ts src/ops/__tests__/doctor-incidents.test.ts src/ops/__tests__/doctor-scheduler.test.ts src/ops/__tests__/doctor-scheduler-boundaries.test.ts src/ops/__tests__/doctor-repair.test.ts src/ops/__tests__/doctor-repair-boundaries.test.ts src/ops/__tests__/doctor-ship.test.ts src/ops/__tests__/doctor-metrics.test.ts` passed, 9 files / 53 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run quality:docs` passed with schema v10.
  - `pnpm run build` passed; generated ignored `dist/` artifacts were removed after verification.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard` passed: `pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- Public API changes: none. Existing imports from `src/ops/doctor.ts` / `../ops/doctor.js` remain valid.
- Follow-up cleanup: Complexity hotspot plan is complete. Future Auto Doctor diagnosis changes should land in `src/ops/doctor/evidence.ts`, `diagnosis.ts`, or `report.ts` with focused tests rather than broadening the facade.
