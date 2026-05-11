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

