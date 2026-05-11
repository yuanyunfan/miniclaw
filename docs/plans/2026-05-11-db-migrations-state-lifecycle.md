# DB Migrations And State Lifecycle Governance

Status: draft
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

