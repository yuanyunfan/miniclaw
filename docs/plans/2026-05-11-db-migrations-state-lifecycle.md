# DB Migrations And State Lifecycle Governance

Status: done
Date: 2026-05-11

## Background

`src/store/db.ts` currently owns schema creation, schema version upgrades, task helpers, chat history helpers, Smart Router helpers, and multiple runtime state tables. As MiniClaw accumulates `task_events`, incidents, repair runs, market forecasts, Smart Router evaluation fields, and future cron run history, a single DB module becomes hard to review.

State lifecycle also needs explicit governance. MiniClaw stores private operational data: prompts, trace summaries, provider payload summaries, account-adjacent data, email-derived data, and incident evidence. Long-running use should not accumulate sensitive data forever.

## Goals

- Introduce versioned migration modules under `src/store/migrations/`.
- Add schema migration audit/history.
- Split table-specific repository helpers from DB initialization.
- Add retention policy config and cleanup command.
- Define redaction policy for exports and diagnostic bundles.
- Keep existing user DB upgrade path safe.

## Non-Goals

- Do not drop or rewrite the user's existing DB.
- Do not migrate to a different database engine.
- Do not implement all repository splits in one commit.
- Do not remove existing `src/store/db.ts` exports before call sites migrate.
- Do not silently delete data without explicit config and a dry-run command first.

## Existing Architecture Evidence

- `src/store/db.ts`: exports `SCHEMA_VERSION`, opens SQLite, creates tables, applies migrations, and provides many helper methods.
- `src/store/task-events.ts`: already split out from DB for task event append/list/count.
- `src/store/incidents.ts`: already split out for incidents, incident events, and repair runs.
- `src/store/market-forecasts.ts`: separate market forecast repository.
- `src/store/__tests__/db.test.ts`: checks table/column existence.
- `docs/architecture.md`: records schema version and ER diagram.
- `scripts/quality-docs.ts`: checks docs schema version equals code schema version.

## Target Store Layout

```text
src/store/
  db.ts                         # open DB, init, compatibility exports
  connection.ts                 # getDb/open/close/test reset if useful
  schema.ts                     # SCHEMA_VERSION and migration runner
  migrations/
    001-initial.ts
    002-chat-history.ts
    ...
    009-router-feedback.ts
  repositories/
    tasks.ts
    chat-history.ts
    smart-router-decisions.ts
    task-events.ts              # may keep current path and re-export
    incidents.ts                # may keep current path and re-export
    market-forecasts.ts         # may keep current path and re-export
```

Use facade exports to avoid a single massive import migration.

## Schema Audit Proposal

Add a table:

```sql
CREATE TABLE IF NOT EXISTS schema_version_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_version INTEGER,
  to_version INTEGER NOT NULL,
  migration_name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Rules:

- Each migration records one row after successful execution.
- Re-running init should not duplicate audit rows for already applied migrations.
- Failed migrations should not bump `PRAGMA user_version` or equivalent schema metadata.

## Retention Policy Proposal

Config candidates:

```yaml
state:
  retention:
    chat_history_days: 90
    task_events_days: 90
    smart_router_decisions_days: 180
    incidents_days: 365
    repair_runs_days: 365
    market_forecasts_days: 730
    dry_run_default: true
```

Cleanup command candidates:

- `pnpm state:cleanup -- --dry-run`
- `pnpm state:cleanup -- --execute`
- `pnpm state:cleanup -- --table task_events --older-than-days 30`

Initial implementation should default to dry-run.

## Redaction Policy

Add a central policy for diagnostic exports:

- Prompt previews are capped and may be hashed.
- Raw prompts are excluded by default.
- Provider payloads are excluded unless a provider-specific allowlist exists.
- Email/account/broker fields must be redacted by provider-specific redactors.
- Token-like strings, cookies, authorization headers, and session ids are always redacted.
- Diagnostic bundles include a manifest of omitted/redacted fields.

This policy should be reused by task trace export, incident center, provider dry-run, and state cleanup reports.

## Implementation Plan

1. Add migration runner tests before moving logic.
   - Test applying migrations from an empty DB.
   - Test a DB at an older version upgrades to current version.
   - Test idempotent second init.
2. Extract `SCHEMA_VERSION` and migration runner.
   - Keep `src/store/db.ts` as public facade.
   - Move current inline migration blocks into migration functions without changing SQL.
3. Add `schema_version_history`.
   - Migration runner records applied migrations.
   - Add repository/helper to inspect history for diagnostics.
4. Split repositories incrementally.
   - First candidate: Smart Router decisions, because evaluation-loop work will add fields.
   - Keep task repository split separate if it becomes too large.
   - Use re-exports from `db.ts` to avoid broad call-site churn.
5. Add retention config.
   - If config schema-first refactor is not landed, add fields conservatively to current config.
   - Include env overrides only if the project pattern requires it.
6. Add cleanup command.
   - New script `scripts/state-cleanup.ts`.
   - Package script candidate `"state:cleanup": "tsx scripts/state-cleanup.ts"`.
   - Dry-run output lists table, count, oldest/newest timestamps, and delete SQL summary.
7. Add redaction policy helpers.
   - Candidate file: `src/privacy/redaction.ts` or `src/store/redaction.ts`.
   - Prefer a neutral location if provider framework will use it too.
8. Update docs and quality checks.
   - Update `docs/architecture.md` schema version and migration layout.
   - Update `scripts/quality-docs.ts` if schema version extraction path changes.

## Verification Plan

- Focused:
  - `pnpm vitest run src/store/__tests__/db.test.ts`
  - Add `src/store/__tests__/migrations.test.ts`
  - Add `src/store/__tests__/state-cleanup.test.ts` if cleanup logic is pure/testable.
- Static:
  - `pnpm run typecheck`
  - `pnpm run lint`
- Regression:
  - `pnpm test`
  - `pnpm run build`
- Manual safety:
  - Use a temp SQLite DB for migration smoke.
  - Run `pnpm state:cleanup -- --dry-run` only; do not execute deletion on the real DB during implementation unless explicitly requested.

## Risks And Rollback

- Risk: migration bug corrupts the user DB.
  - Mitigation: test on temp DB, keep idempotent migrations, document backup command before live migration.
  - Rollback: restore DB backup and revert migration commit.
- Risk: facade/re-export drift breaks imports.
  - Mitigation: keep `db.ts` exports stable until call sites are migrated.
- Risk: cleanup deletes useful state.
  - Mitigation: dry-run default, explicit `--execute`, conservative retention defaults.
- Risk: schema version docs check breaks after file split.
  - Mitigation: update `quality-docs.ts` in the same slice as `SCHEMA_VERSION` move.

## Documentation Sync

- Update `docs/architecture.md` ER diagram, schema version, migration lifecycle, and state retention.
- Update `docs/quality-gates.md` if `quality:docs` starts checking migration files.
- Update provider/incident/trace docs if redaction policy is shared.
- Run `pnpm run quality:docs`.

## Execution Notes

Record migration versions, repository splits, retention defaults, and verification commands here when implemented.

### 2026-05-12 Slice 1: Schema Migration Runner And Audit Boundary

- Scope: first DB lifecycle phase. Extracted base schema creation and current v1-v10 migrations from `src/store/db.ts` without moving task/chat/Smart Router repository helpers yet.
- Migration versions:
  - `SCHEMA_VERSION = 10` in `src/store/schema.ts`.
  - v1-v9 preserve existing schema upgrade behavior.
  - v10 adds `schema_version_history` plus a unique `to_version` index for idempotent audit rows.
- Changed files:
  - `src/store/db.ts`: remains the public facade and re-exports `SCHEMA_VERSION`; `initDb()` now opens SQLite, enables WAL, calls `ensureBaseSchema()`, and runs versioned migrations.
  - `src/store/schema.ts`: owns schema version, base schema creation, migration runner, history listing, and test-only migration application helper.
  - `src/store/migrations/*`: one module per schema version plus shared helpers/types.
  - `src/store/__tests__/migrations.test.ts`: covers new DB migration history, old v4 upgrade, idempotent rerun, and failed migration rollback.
  - `src/store/__tests__/db.test.ts`: covers facade-level history table presence and current history rows.
  - `scripts/quality-docs.ts`, `docs/architecture.md`, `docs/quality-gates.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: moved the schema version source of truth to `src/store/schema.ts` and documented the audit table.
- Verification:
  - `pnpm vitest run src/store/__tests__/migrations.test.ts src/store/__tests__/db.test.ts` passed, 24 tests.
  - `pnpm vitest run src/store` passed, 43 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run quality:docs` passed with schema v10.
  - `pnpm test` passed, 137 files / 684 tests.
  - `pnpm run build` passed; generated ignored `dist/` artifacts were removed after verification.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard` passed.
- Public API changes: existing consumers can continue importing from `src/store/db.ts`; `listSchemaVersionHistory()` is a new diagnostic facade export.
- Follow-up cleanup: split `tasks`, `chat_history`, and Smart Router decision helpers into repository modules; retention config/cleanup and diagnostic redaction remain future phases.

### 2026-05-12 Slice 2: Store Repository Boundary

- Scope: second DB lifecycle phase. Extracted task, chat history, and Smart Router decision helpers from `src/store/db.ts` into repository modules while keeping `src/store/db.ts` as the compatibility facade.
- Repository split:
  - `src/store/connection.ts` owns the live SQLite handle.
  - `src/store/repositories/tasks.ts` owns task rows, creation, updates, lookups, active/interrupted/recent listings, and Smart Router outcome writeback on terminal status changes.
  - `src/store/repositories/chat-history.ts` owns chat history append/list behavior.
  - `src/store/repositories/smart-router-decisions.ts` owns decision logging, confirmation choice, task outcome, recent decision, and review listing helpers.
  - Existing split store modules `task-events.ts`, `incidents.ts`, and `market-forecasts.ts` now depend on `connection.ts` directly instead of importing the public facade.
- Changed files:
  - `src/store/db.ts`: remains the public facade and re-exports repository helpers; Stage scene helpers remain in place.
  - `src/store/__tests__/db.test.ts`: added direct repository characterization tests for task outcome linkage and chat history ordering.
  - `docs/architecture.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: documented the repository boundary and updated current hotspot status.
- Verification:
  - `pnpm vitest run src/store/__tests__/db.test.ts` passed, 22 tests.
  - `pnpm vitest run src/store/__tests__/migrations.test.ts src/store/__tests__/db.test.ts` passed, 26 tests.
  - `pnpm vitest run src/store` passed, 45 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run quality:docs` passed with schema v10.
  - `pnpm run build` passed; generated ignored `dist/` artifacts were removed after verification.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard` passed.
- Public API changes: existing consumers can continue importing task, chat, Smart Router, schema, and `getDb()` helpers from `src/store/db.ts`.
- Follow-up cleanup: retention config, dry-run cleanup command, and shared diagnostic redaction policy remain future phases.

### 2026-05-12 Slice 3: State Retention Cleanup Boundary

- Scope: third DB lifecycle phase. Added configurable retention and a dry-run-first cleanup command without changing schema version or deleting any live user data during verification.
- Retention defaults:
  - `chat_history_days = 90`
  - `task_events_days = 90`
  - `smart_router_decisions_days = 180`
  - `incidents_days = 365`
  - `repair_runs_days = 365`
  - `market_forecasts_days = 730`
  - `dry_run_default = true`
- Changed files:
  - `src/store/state-cleanup.ts`: added state cleanup planning, dry-run savepoint simulation, transaction-backed execute mode, grouped market forecast child cleanup, and closed-incident parent safety checks.
  - `scripts/state-cleanup.ts`, `package.json`: added `pnpm run state:cleanup -- [--dry-run | --execute] [--table <scope>] [--older-than-days <n>]`.
  - `src/config.ts`, `src/__tests__/config.test.ts`, `config.example.yaml`: added `state.retention.*` YAML/env configuration with env override coverage.
  - `src/store/__tests__/state-cleanup.test.ts`: covered dry-run rollback behavior, single-scope cleanup, market forecast child-before-parent deletion, and closed incident safety.
  - `docs/architecture.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: documented retention defaults, cleanup command, and remaining redaction-policy gap.
- Verification:
  - `pnpm vitest run src/store/__tests__/state-cleanup.test.ts` passed, 6 tests.
  - `pnpm vitest run src/__tests__/config.test.ts` passed, 17 tests.
  - `pnpm vitest run src/store` passed, 7 files / 51 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run quality:docs` passed with schema v10.
  - `pnpm run build` passed; generated ignored `dist/` artifacts were removed after verification.
  - Temp DB smoke `pnpm run state:cleanup -- --dry-run --table task_events --older-than-days 30` passed with 0 candidates against `/private/tmp/miniclaw-state-cleanup-smoke.db`; temp DB artifacts were removed after verification.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard` passed: `pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- Public API changes: none for existing DB facade consumers. New cleanup helpers live in `src/store/state-cleanup.ts`; the cleanup command defaults to dry-run unless config or CLI selects execute mode.
- Follow-up cleanup: shared diagnostic redaction policy remains future Slice F work.

### 2026-05-12 Slice 4: Shared Diagnostic Redaction Boundary

- Scope: final DB lifecycle/state governance phase. Added a reusable diagnostic redaction policy and connected it to task trace export plus Auto Doctor incident detail rendering.
- Redaction policy:
  - `src/privacy/diagnostic-redaction.ts` owns shared text/object redaction for authorization headers, cookies, tokens, prompt/body fields, raw provider payload fields, email/phone text, and session/account identifiers.
  - Session/account identifiers are replaced with deterministic short hashes for correlation without exposing raw values.
  - Task trace export remains allowlist-first; disallowed payload keys continue to be counted as `redacted_payload_keys`.
- Changed files:
  - `src/privacy/diagnostic-redaction.ts`: added shared diagnostic redaction helpers and policy text.
  - `src/store/task-trace-export.ts`: replaced local redaction regex with shared diagnostic redaction and redacted task/session ids in exported models/Markdown.
  - `src/commands/incident-detail.ts`: routed summary, source/diagnosis fields, trace snippets, repair paths, and incident event payload text through the shared diagnostic redaction policy.
  - `src/commands/task-log.ts`, `src/discord/task-trace-attachment.ts`: updated user-facing safety copy to include session/account redaction.
  - `src/privacy/__tests__/diagnostic-redaction.test.ts`, `src/store/__tests__/task-trace-export.test.ts`, `src/commands/__tests__/incident-detail.test.ts`: covered credential text, recursive object redaction, hashed session/account identifiers, trace export redaction, and incident detail redaction.
  - `docs/architecture.md`, `docs/features/03-discord-task-output.md`, `docs/features/13-auto-doctor.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: documented the shared diagnostic redaction boundary and updated hotspot status.
- Verification:
  - `pnpm vitest run src/privacy/__tests__/diagnostic-redaction.test.ts src/store/__tests__/task-trace-export.test.ts src/commands/__tests__/incident-detail.test.ts` passed, 12 tests.
  - `pnpm vitest run src/commands/__tests__/task-log.test.ts src/discord/__tests__/task-view-reporter.test.ts` passed, 11 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run quality:docs` passed with schema v10.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard` passed: `pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- Public API changes: existing task trace functions remain exported; exported trace models now contain redacted session identifiers rather than raw session ids.
- Follow-up cleanup: DB migration/state lifecycle plan is complete. Future provider dry-run or diagnostic bundle work should reuse `src/privacy/diagnostic-redaction.ts` rather than introducing provider-local generic secret regex.
