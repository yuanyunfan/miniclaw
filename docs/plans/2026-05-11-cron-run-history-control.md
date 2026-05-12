# Cron Run History And Per-Job Control

Status: draft
Date: 2026-05-11

## Background

MiniClaw cron already supports task/script/skill/message jobs, `pre_script`, `pre_provider`, retry button, failure alerts, and provider-side `skipTask`. The next problem is long-term operation: diagnosing success rate, failure categories, run duration, provider preflight state, job-level SLA, backoff, cooldown, and concurrency.

Current state is spread across scheduler state, logs, task rows, and incidents. A first-class `cron_runs` history would let the user inspect recent runs and link cron failures to task traces and incident details.

## Goals

- Add durable cron run history.
- Add per-job timeout, max concurrency, retry/backoff/cooldown, and circuit breaker fields.
- Add provider health/dry-run preflight before LLM task execution where supported.
- Link cron failure notification to run detail, task trace, and incident detail.
- Add local and Discord query surfaces for recent cron runs.

## Non-Goals

- Do not remove existing `~/.miniclaw/cron/state.json` in the first slice.
- Do not call real LLMs during provider health preflight.
- Do not make provider preflight mandatory for legacy providers immediately.
- Do not let Discord users create arbitrary cron jobs.
- Do not run real cron E2E against production config.

## Existing Architecture Evidence

- `src/cron/types.ts`: cron job definitions, task/script/skill/message modes, `pre_provider`, `pre_provider_config`.
- `src/cron/loader.ts`: loads user cron YAML and validates providers.
- `src/cron/runner-task.ts`: runs pre-provider and downstream `executeTask`.
- `src/cron/scheduler.ts`: scheduling, retry, running jobs, failure alerts.
- `src/cron/state.ts`: JSON state persistence.
- `src/cron/failure-notifier.ts`: Discord failure/recovered alert behavior.
- `src/cron/retry-interactions.ts`: retry button behavior.
- `scripts/cron-list.ts` and `scripts/cron-test.ts`: local cron surfaces.
- `pnpm run e2e:cron`: deterministic cron fixture gate.

## Data Model Proposal

Add a `cron_runs` table:

```sql
CREATE TABLE cron_runs (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  scheduled_at TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  task_id TEXT,
  incident_id TEXT,
  provider_name TEXT,
  provider_status TEXT,
  provider_category TEXT,
  error_category TEXT,
  error_message TEXT,
  alert_message_id TEXT,
  alert_channel_id TEXT,
  metadata_json TEXT
);

CREATE INDEX idx_cron_runs_job_started ON cron_runs(job_name, started_at);
CREATE INDEX idx_cron_runs_status_started ON cron_runs(status, started_at);
```

Status values:

- `running`
- `success`
- `skipped`
- `failed`
- `retry_scheduled`
- `cancelled`
- `circuit_open`

## Config Proposal

Per-job YAML candidates:

```yaml
timeout_ms: 1800000
max_concurrency: 1
retry:
  max_attempts: 5
  backoff_ms: [600000, 1200000, 2400000, 4800000]
cooldown:
  after_failure_ms: 1800000
circuit_breaker:
  enabled: true
  failure_threshold: 3
  window_ms: 86400000
  open_ms: 3600000
provider_preflight:
  enabled: true
  mode: health
```

Keep defaults compatible with current behavior.

## Implementation Plan

1. Add cron run repository.
   - Candidate file: `src/store/cron-runs.ts`.
   - Helpers:
     - `createCronRun`
     - `markCronRunCompleted`
     - `markCronRunFailed`
     - `listCronRuns`
     - `summarizeCronRuns`
   - Add schema tests.
2. Instrument scheduler.
   - Create a run id for every scheduled/manual/test run.
   - Record start, attempt, job type, and scheduled time.
   - Record status and duration on completion/failure/skip.
   - Link task id when task runner creates a task.
3. Keep JSON state compatibility.
   - Continue writing `state.json` for current scheduler behavior.
   - Do not make `cron_runs` the only source of truth until stable.
4. Add provider preflight hook.
   - If provider framework has landed, call `healthCheck` or `dryRun` before LLM task.
   - If not landed, design hook but leave it disabled.
   - Record provider status/category in `cron_runs`.
   - For auth/session failure, skip LLM task and mark run `skipped` or `failed` with actionable category.
5. Add per-job timeout and concurrency.
   - Enforce `max_concurrency` by job name first.
   - Add full-job timeout wrapper around pre-script/pre-provider/task path.
   - Ensure timeout marks run and creates/updates incident.
6. Add cooldown and circuit breaker.
   - Compute from `cron_runs`, not only last state.
   - Circuit-open runs should be visible and not silently ignored.
7. Extend failure notifier.
   - Include run id.
   - Include command hints:
     - `/cron-run id:<run-id>` if added;
     - `/task-log id:<task-id>` if task exists;
     - `/incident view id:<incident-id>` if incident exists.
8. Add local query script.
   - Candidate: `scripts/cron-runs.ts`.
   - Package script: `"cron:runs": "tsx scripts/cron-runs.ts"`.
   - Output terminal-friendly grouped summaries.
9. Optional Discord command.
   - `/cron-runs job:<optional> limit:<n>`
   - `/cron-run id:<run-id>`
   - Keep slash surface small; CLI can land first.
10. Add tests and fixtures.
    - Scheduler success/failure/skip run rows.
    - Retry/backoff/cooldown behavior.
    - Circuit breaker behavior.
    - Provider preflight categories.

## Verification Plan

- Focused:
  - `pnpm vitest run src/cron/__tests__/scheduler.test.ts src/cron/__tests__/failure-notifier.test.ts src/cron/__tests__/state.test.ts`
  - Add `src/store/__tests__/cron-runs.test.ts`.
  - Add cron control tests as new behavior lands.
- E2E fixture:
  - `pnpm run e2e:cron`
- Static:
  - `pnpm run typecheck`
  - `pnpm run lint`
- Full:
  - `pnpm test`
  - `pnpm run build`

## Risks And Rollback

- Risk: scheduler creates duplicate or orphaned run rows.
  - Mitigation: one run id per attempt; idempotent finalization helper.
- Risk: timeout cancels a task incorrectly.
  - Mitigation: distinguish pre-provider timeout from downstream task timeout; rely on existing cancel/interrupt path.
- Risk: provider preflight changes production cron behavior too much.
  - Mitigation: config-gate preflight; record-only mode first if needed.
- Risk: circuit breaker hides important failures.
  - Mitigation: circuit-open runs are recorded and notified with next retry/open-until time.

## Documentation Sync

- Update `docs/architecture.md` cron section and ER diagram.
- Update relevant cron/provider feature docs.
- Update `docs/bot-routing.md` if slash commands or buttons are added.
- Run `pnpm run quality:docs`.

## Execution Notes

Record schema version, config defaults, query commands, and verification output here when implemented.

### 2026-05-12 Ralph iteration: durable run history foundation

- Implemented schema v11 with `cron_runs` plus `idx_cron_runs_job_started` and `idx_cron_runs_status_started`.
- Added `src/store/cron-runs.ts` helpers: `createCronRun`, `markCronRunCompleted`, `markCronRunFailed`, `getCronRun`, `listCronRuns`, and `summarizeCronRuns`.
- Instrumented scheduler dispatch to create one `cron_runs` row per attempt, including skipped dispatches during drain/concurrency, `retry_scheduled` rows before retry backoff, final `failed` rows, and successful/skipped outcomes.
- Runner outcomes now carry task/provider metadata so task and skill cron runs can link `task_id`, and pre-provider `skipTask` outcomes are stored as `skipped`.
- Kept JSON `state.json` writes as the compatibility source for current `cron:list` and retry button behavior.
- Updated `docs/architecture.md` SQLite schema notes and ER diagram to schema v11 / `cron_runs`.
- Verification:
  - `pnpm exec vitest run src/store/__tests__/cron-runs.test.ts src/store/__tests__/migrations.test.ts src/store/__tests__/db.test.ts src/cron/__tests__/scheduler.test.ts src/cron/__tests__/runner-task.test.ts src/cron/__tests__/runner-script.test.ts src/cron/__tests__/runner-message.test.ts` passed: 7 files, 60 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run e2e:cron` passed: `Cron E2E fixture passed: cron-e2e-1778599767213`.
  - `pnpm run quality:docs` passed with schema v11.
  - `pnpm run lint` passed.

### 2026-05-12 Ralph iteration: provider preflight run metadata

- Completed the provider preflight history gap: health and dry-run preflight failures now propagate provider name, provider status, provider category, and actionable error category into the scheduler.
- Legacy `pre_provider` collection failures now use the provider error categorizer before raising `CronTaskRunError`, so `cron_runs.provider_*` and `cron_runs.error_category` are no longer left as generic task-run errors for provider failures.
- Scheduler failure finalization now persists `errorCategory` carried by runner errors before falling back to the generic JavaScript error name.
- Added tests for health preflight metadata, dry-run preflight metadata, and durable `cron_runs` rows for unsupported provider preflight.
- Updated `docs/features/16-provider-framework.md` with the persisted preflight/provider failure metadata contract.
- Verification:
  - `pnpm exec vitest run src/cron/__tests__/runner-task.test.ts src/cron/__tests__/scheduler.test.ts` passed: 2 files, 22 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run e2e:cron` passed: `Cron E2E fixture passed: cron-e2e-1778600152507`.
  - `pnpm run quality:docs` passed with schema v11.

### 2026-05-12 Ralph iteration: per-job timeout and concurrency

- Added cron YAML support for `timeout_ms` and `max_concurrency`; `max_concurrency` defaults to 1 to preserve the previous same-job single-run guard, while `timeout_ms` is opt-in.
- Replaced scheduler same-name `Set` tracking with per-job running counts, so configured jobs can run up to their own concurrency limit and skipped overflow dispatches are persisted as `cron_runs.status=skipped` with `error_category=max_concurrency`.
- Added scheduler-level full-job timeout wrapping. The timeout abort signal is propagated into task, skill, script, pre-script, and message runners; task execution now accepts an external abort signal and preserves the abort reason in task output.
- Timeout failures are persisted in `cron_runs` with `error_category=cron_timeout`, linked task id when available, and a `cron_failed` incident row plus incident event keyed by the retry chain's `failure_run_id`.
- Updated `docs/architecture.md` cron flow to document `max_concurrency`, `timeout_ms`, timeout history rows, and timeout incidents.
- Verification:
  - `pnpm exec vitest run src/cron/__tests__/loader.test.ts src/cron/__tests__/scheduler.test.ts src/cron/__tests__/runner-script.test.ts src/cron/__tests__/runner-task.test.ts` passed: 4 files, 53 tests.
  - `pnpm exec vitest run src/agent/__tests__/task-helpers.test.ts src/agent/__tests__/e2e-fake-runtime.test.ts src/agent/__tests__/task-runtime-registry.test.ts` passed: 3 files, 23 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run e2e:cron` passed: `Cron E2E fixture passed: cron-e2e-1778601087271`.
  - `pnpm run quality:docs` passed with schema v11.

### 2026-05-12 Ralph iteration: cooldown and circuit breaker gates

- Added cron YAML support for `cooldown.after_failure_ms` and `circuit_breaker` with bounded defaults for threshold/window/open duration.
- Added `getCronRunFailureWindow()` so cooldown and circuit breaker decisions are computed from durable `cron_runs`, ignoring circuit-open/skipped rows and resetting after a later successful run.
- Scheduler dispatch now applies cooldown/circuit gates after the same-job concurrency slot is acquired and before retry attempts begin; cooldown writes `cron_runs.status=skipped` / `error_category=cooldown`, while circuit breaker writes `cron_runs.status=circuit_open` / `error_category=circuit_open` plus open-until metadata.
- JSON `state.json` compatibility remains intact: blocked dispatches still call `recordRun()` and expose `next_retry_at` for local status surfaces.
- Updated `docs/architecture.md` cron section to document the new history-backed gates.
- Verification:
  - `pnpm exec vitest run src/cron/__tests__/loader.test.ts src/cron/__tests__/scheduler.test.ts src/store/__tests__/cron-runs.test.ts` passed: 3 files, 44 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run e2e:cron` passed: `Cron E2E fixture passed: cron-e2e-1778601660368`.
  - `pnpm run quality:docs` passed with schema v11.
