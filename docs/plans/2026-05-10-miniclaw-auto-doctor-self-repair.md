# MiniClaw Auto Doctor And Self-Repair Loop

Status: in_progress
Date: 2026-05-10

## Background

MiniClaw is now used as a long-running Discord task runner. Failures often show up as Discord task errors, cron failures, chat reply errors, interrupted task rows, PM2 restarts, or connectivity outages. The current operating model is still mostly manual: the user notices the symptom, asks MiniClaw or Codex to inspect logs/DB/state, then asks for a code fix.

The target direction is a controlled self-evolution loop: MiniClaw should detect runtime problems, collect evidence, produce a diagnosis, and, for safe low-risk cases, run an isolated repair workflow that can create a verified patch. Only after quality gates pass and restart safety checks are satisfied should it commit, push, and optionally update the running PM2 app.

The key design constraint is that the main MiniClaw process must not blindly modify or restart itself. The safe shape is an Auto Doctor in the runtime plus a separate Self-Repair Worker.

## Goals

1. Automatically detect incidents from task, cron, PM2, log, and connectivity state.
2. Preserve enough context for diagnosis without requiring the user to paste logs into Discord manually.
3. Let MiniClaw produce a structured root-cause report for each incident.
4. Support a guarded repair workflow that can generate patches in an isolated workspace.
5. Run targeted tests and existing quality gates before any commit or push.
6. Use `pnpm safe-restart` for runtime updates and refuse restart when active tasks or chats exist.
7. Keep every repair auditable: incident record, evidence bundle, diff, verification output, commit SHA, push target, and restart result.

## Non-Goals

- Do not let the Discord bot main process directly edit the main working tree.
- Do not auto-fix secrets, account sessions, cookies, credentials, or auth failures.
- Do not auto-force-push, rewrite history, or run destructive Git operations.
- Do not auto-merge large architecture changes into `main`.
- Do not bypass existing quality gates.
- Do not treat every task failure as a MiniClaw code bug; user prompt issues, provider data absence, network outages, and third-party failures must remain separate classifications.

## Existing Architecture Evidence

- `src/store/db.ts` persists task rows with `running`, `interrupted`, `completed`, `failed`, and `cancelled` status values plus Discord source metadata.
- `src/agent/task.ts` owns in-process active task tracking, cancellation, graceful drain waits, and interrupted-task persistence.
- `src/agent/recovery.ts` marks stale running tasks as interrupted on startup and posts recovery guidance into Discord threads.
- `src/runtime/shutdown.ts` is the shared draining-state holder; new work rejects while drain is active.
- `src/index.ts` owns the graceful shutdown path: stop monitor/scheduler, wait for task drain, interrupt remaining tasks only after timeout, then exit.
- `src/cron/scheduler.ts` records cron run status, retries failures, and can send/update Discord failure alerts.
- `src/monitoring/connectivity-monitor.ts` and `src/monitoring/connectivity-core.ts` probe Discord, general network, and SMTP reachability, then persist runtime connectivity state.
- `src/ops/safe-restart.ts` refuses PM2 restart when the MiniClaw SQLite DB contains `status='running'` tasks unless `--force` is explicitly provided.
- `package.json` exposes `quality:commit` and `quality:push`; Git hooks call these gates before commit and push.
- `src/routing/intent.ts` already treats runtime diagnostics terms such as "任务失败", "回复出错", "排查", and "why fail" as task-like work rather than lightweight chat.

## Proposed Architecture

### 1. Incident Detector

Add a detector layer that periodically scans runtime sources and normalizes symptoms into incidents.

Input sources:

- SQLite task DB: recent `failed`, `interrupted`, and long-running `running` rows.
- Cron state: jobs with `last_status='error'`, retry metadata, and last error text.
- PM2 state: restart count, status, uptime, unstable restart loops.
- MiniClaw logs: recent error lines from `~/.miniclaw/logs/miniclaw-error.log` and selected out log windows.
- Connectivity state: `~/.miniclaw/runtime/connectivity.json`.
- Git state: current commit SHA, branch, dirty status, remote, and local hook availability.

Suggested incident types:

- `task_failed`
- `task_interrupted`
- `task_running_too_long`
- `cron_failed`
- `chat_error`
- `discord_outage`
- `pm2_restart_loop`
- `quality_gate_failed`

### 2. Auto Doctor

Auto Doctor is read-only. It should collect evidence, classify the failure, and post a diagnosis to Discord.

Expected diagnosis fields:

- incident id
- severity
- likely category: `user_prompt`, `network`, `discord`, `provider_data`, `provider_auth`, `miniclaw_bug`, `third_party`, `unknown`
- affected task id / cron job / thread / message URL
- evidence summary
- suspected root cause
- whether repair is allowed by policy
- recommended next action

This layer should be safe to enable first because it does not modify code or runtime state.

### 3. Self-Repair Worker

Self-Repair Worker is a separate CLI/script, not logic embedded in the long-running Discord bot.

Suggested command:

```bash
pnpm doctor:repair -- --incident <incident-id>
```

Worker responsibilities:

1. Load the incident and evidence bundle.
2. Refuse if the main workspace is dirty unless explicitly configured to use a separate worktree.
3. Create or reuse an isolated repair worktree under a path such as:

```text
~/ProjectRepo/miniclaw-repairs/<incident-id>
```

4. Ask the coding agent to implement a narrow fix using the incident report as input.
5. Require a failing or targeted test when the bug is testable.
6. Run verification gates.
7. Produce a repair report with changed files, diff summary, tests, and remaining risks.

### 4. Ship Controller

Ship Controller decides whether a repair can be committed, pushed, and deployed.

Default policy:

- Auto commit is allowed only for low-risk, allowlisted changes with passing verification.
- Auto push should initially target a repair branch, not `main`.
- Updating the live PM2 app must go through `pnpm safe-restart`.
- Restart is refused when active MiniClaw tasks or chats exist.
- Main-branch push or live restart should require explicit approval until the system proves reliable.

Low-risk allowlist candidates:

- Smart router false positive/negative fixes.
- Task metadata/context propagation bugs.
- Cron runner bugs.
- Cron failure alert formatting bugs.
- Provider parsing bugs with fixture-based tests.
- Typed error handling improvements.

Always require approval:

- Secrets, credentials, cookies, sessions, auth config.
- Git history operations.
- Schema migrations.
- Destructive file operations.
- Large refactors or cross-cutting architecture changes.
- Any forced restart while active tasks exist.

## Data Model

Add tables after the read-only doctor prototype proves useful.

```sql
CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  subject_id TEXT,
  subject_type TEXT,
  source_json TEXT,
  evidence_json TEXT,
  diagnosis_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE incident_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (incident_id) REFERENCES incidents(id)
);

CREATE TABLE repair_runs (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  status TEXT NOT NULL,
  workspace_path TEXT,
  branch TEXT,
  base_sha TEXT,
  commit_sha TEXT,
  verification_json TEXT,
  report_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (incident_id) REFERENCES incidents(id)
);
```

Incident statuses:

- `open`
- `diagnosing`
- `diagnosed`
- `repair_blocked`
- `repairing`
- `repair_ready`
- `shipped`
- `resolved`
- `ignored`

## Implementation Plan

### Phase 1: Read-Only Doctor

1. Add `src/ops/doctor/` modules for evidence collection:
   - task DB collector
   - cron state collector
   - PM2 collector
   - log window collector
   - connectivity collector
   - git state collector
2. Add `scripts/doctor.ts` with modes:
   - `pnpm run doctor -- --recent`
   - `pnpm run doctor -- --task <task-id>`
   - `pnpm run doctor -- --cron <job-name>`
   - `pnpm run doctor -- --json`
3. Add a Discord slash command or button path:
   - `/doctor`
   - `/doctor task_id:<id>`
   - cron failure alert button: `诊断`
4. Render a concise diagnosis into Discord without making changes.

### Phase 2: Incident Persistence

1. Add `incidents` and `incident_events` tables.
2. Deduplicate incidents by source and time window.
3. Let task failures, cron failures, chat errors, connectivity outages, and restart recovery create incident records.
4. Show open incident counts in `/health`.
5. Add `/incidents` and `/incident id:<id>` read-only commands if useful.

### Phase 3: Controlled Repair Worker

1. Add `scripts/doctor-repair.ts`.
2. Create isolated repair worktrees.
3. Generate a strict repair prompt from the incident:
   - evidence bundle
   - current architecture notes
   - allowed paths
   - required verification
   - forbidden operations
4. Run targeted tests, then broader gates as needed.
5. Post repair report to Discord.
6. Do not auto-push to `main` in this phase.

### Phase 4: Guarded Auto Ship

1. Add config:
   - `doctor.enabled`
   - `doctor.auto_diagnose_enabled`
   - `doctor.auto_repair_enabled`
   - `doctor.auto_push_enabled`
   - `doctor.auto_restart_enabled`
   - `doctor.allowed_paths`
   - `doctor.max_patch_files`
   - `doctor.require_approval_for_main`
2. Auto commit and push only when:
   - incident category is allowlisted
   - changed paths are allowlisted
   - patch size is below threshold
   - tests pass
   - secret and G0 checks pass
   - no unrelated dirty changes are present in the target workspace
3. Use `pnpm safe-restart --json` for live update.
4. Require explicit approval for main branch update or restart until enough successful repair history exists.

## Verification Plan

Phase 1:

- Unit tests for evidence collectors with fixture DB/log/state files.
- Unit tests for diagnosis rendering and redaction.
- `pnpm run typecheck`
- `pnpm vitest run src/ops/doctor`

Phase 2:

- DB migration tests.
- Incident deduplication tests.
- `/health` formatter tests for open incident counts.
- Cron failure to incident integration test.

Phase 3:

- Worktree creation tests with temporary Git repos.
- Repair policy tests for dirty main workspace, forbidden paths, and blocked incident categories.
- Verification runner tests for pass/fail propagation.
- Manual dry run against a synthetic incident.

Phase 4:

- End-to-end dry run: create synthetic bug incident, repair branch, test, commit, push disabled.
- Safe restart smoke:
  - with running tasks or active chats: restart refused
  - without running tasks or active chats: restart allowed
- Audit report snapshot tests.

## Runtime And Security Rules

- Redact tokens, cookies, authorization headers, session strings, and long high-entropy values from all evidence.
- Never include runtime logs, DB files, private docs, or attachment caches in commits.
- Never run repair on the main worktree if it has unrelated dirty changes.
- Never call full `createBot()` from diagnostic CLIs; use minimal clients or no Discord client at all.
- Never bypass `pnpm safe-restart`.
- Never force-push.
- Keep Auto Doctor read-only by default.
- Keep Self-Repair Worker disabled unless explicitly configured.

## Discord UX

Recommended commands/buttons:

- `/doctor`: show recent incidents and system diagnosis summary.
- `/doctor task_id:<id>`: diagnose a specific task.
- `/doctor cron:<job-name>`: diagnose a specific cron job.
- `/incidents`: list open incidents.
- `诊断`: button on cron/task failure alerts.
- `尝试修复`: approval button after a diagnosis says repair is safe.
- `部署修复`: approval button after verification passes.

Suggested diagnosis message shape:

```text
MiniClaw Doctor: task_failed

Likely category: miniclaw_bug
Affected task: abc12345
Evidence:
- task status changed to failed at ...
- matching error lines ...
- current PM2 app is online, no restart loop detected

Recommended action:
- This looks repairable.
- Proposed repair scope: src/routing, src/discord tests.
- Approval required before code changes.
```

## Risks And Rollback

- Risk: false diagnosis leads to unnecessary repair work.
  - Mitigation: keep diagnosis read-only first and expose evidence clearly.
- Risk: automatic repair touches user work.
  - Mitigation: use isolated worktrees and refuse dirty target workspaces.
- Risk: repair pushes broken code.
  - Mitigation: require quality gates, path allowlist, patch-size limits, and branch-first shipping.
- Risk: repair restarts MiniClaw while tasks or chats are running.
  - Mitigation: only use `pnpm safe-restart`; default refusal protects active tasks and chats.
- Risk: sensitive data leaks into reports or commits.
  - Mitigation: central redaction utilities plus G0/secrets gates before commit and push.
- Rollback: disable with `doctor.enabled: false`; remove repair worktrees; revert repair commits normally.

## Documentation Sync

- `docs/architecture.md`: add the Auto Doctor and Self-Repair Worker once implementation starts.
- `docs/quality-gates.md`: document repair-specific verification gates when Phase 3 exists.
- `docs/features/`: add a feature doc after the first user-facing `/doctor` command lands.
- `README.md`: add only a short operator summary after the feature is usable.

## Execution Notes

- Phase 1 read-only Auto Doctor has been implemented.
  - Added `pnpm run doctor` for local CLI diagnosis. `pnpm doctor` is a pnpm builtin and should not be used for this project script.
  - Added `/doctor` slash command for Discord read-only diagnosis.
  - Added collectors for task DB, cron state, PM2 state, logs, connectivity state, and Git state.
  - Added diagnosis classification for task failures, interrupted/long-running tasks, cron failures, Discord/connectivity issues, PM2 restart loops, provider auth/data issues, and likely MiniClaw bugs.
  - Added tests under `src/ops/__tests__/doctor.test.ts`.
- Historical note after Phase 1: incident DB, persistent incident deduplication, self-repair worker, auto commit/push, and live self-update were not implemented yet.
- Current safe restart and graceful drain behavior must remain the runtime update boundary.
- Historical next slice after Phase 1 was Phase 2: incident persistence and `/health` open-incident visibility.
- Phase 2 automatic diagnosis implementation has started.
  - Added doctor config for scheduled scanning, Auto Improve summary channel delivery, and future repair gates.
  - Added incident, incident event, and repair run persistence with deterministic dedupe keys.
  - Added a scheduled read-only Auto Doctor loop that can create/update incidents and notify only new or severity-escalated incidents.
  - Added `/incidents` and open incident count in `/health`.
  - Self-repair worker, auto commit/push, and live self-update are still pending.
- Phase 3A code shipped:
  - Added `pnpm run doctor:repair` for guarded incident repair dry-runs and execute mode.
  - Added isolated repair worktree and branch creation under `doctor.repair_worktree_root`.
  - Added repair policy gates, allowed/blocked path validation, and verification commands.
  - Repair results are persisted in `repair_runs`; successful verification marks incidents `repair_ready`.
  - Auto commit/push, automatic scheduler enqueueing, and live self-update are still pending.
- Phase 3A automatic dispatch shipped:
  - The scheduled doctor loop now attempts repair-eligible incidents when `doctor.auto_repair_enabled=true`.
  - Auto repair respects `doctor.max_parallel_repairs` and `doctor.max_repairs_per_day`.
  - Repair summaries are posted to the configured Auto Improve summary channel.
  - Later scheduled scans preserve repair lifecycle states instead of downgrading them back to `diagnosed`.
- Phase 3B repair commit policy shipped:
  - Repair verification now runs G0, secrets, targeted Vitest where applicable, typecheck, lint, test, and build before commit.
  - Verified repairs are committed only on the isolated `doctor-repair/<incident-id>` branch.
  - Repair commits use the configured personal project author and include the Codex co-author trailer.
- Phase 4A repair branch push shipped:
  - When `doctor.auto_push_enabled=true`, verified repair commits are pushed only to the isolated `doctor-repair/<incident-id>` branch.
  - Push success/failure is recorded in incident events and included in the Discord repair summary.
  - Automatic main update and live self-update remain pending by design; guarded operator approval is handled by Phase 4B.
- Phase 4B guarded ship shipped:
  - Added `pnpm run doctor:ship` as the explicit approval boundary after a repair branch is pushed.
  - Default mode is dry-run; main update requires `--execute --approve-main` while `doctor.require_approval_for_main=true`.
  - The ship path requires a clean live `main` worktree, fetches the recorded repair branch, verifies the commit SHA, fast-forwards `main`, and pushes `HEAD:main`.
  - Optional `--restart` calls safe-restart without force; active tasks defer live restart instead of being interrupted.
- Phase 5A incident detail and lifecycle first slice shipped:
  - Added `/incident view` for status, diagnosis, source metadata, latest repair run, recent events, and suggested operator commands.
  - Added `/incident resolve` and `/incident ignore`; both write incident events and remove the incident from the default open list.
  - Added `/incident retry-repair`, which reopens eligible incidents for the scheduled doctor loop without bypassing repair policy or approval gates.
  - Added `/incident ship-preview`, which runs the guarded `doctor:ship` dry-run path and records a preview event.
- Phase 5B task trace first slice shipped:
  - Added a normalized `task_events` table and `TaskReporter` boundary for lifecycle, provider/tool, Discord delivery, cancellation, interruption, and finish events.
  - Discord task intake, slash resume, thread continuation, and cron task dispatch now record accepted/context trace events after task creation.
  - Auto Doctor collects structured task trace events and uses them in category classification, evidence summaries, and formatted reports before falling back to raw logs.
  - Persisted task incidents now include relevant trace events, and `/incident view` shows recent task trace rows when available.
- Phase 5C repair quality metrics shipped:
  - Added repair metrics over recent `repair_runs`, grouped by status, incident type, and diagnosis category.
  - Metrics include successful/pushed/blocked/shipped counts, possible post-ship regression incidents within 72 hours, average changed file count, and average verification gate duration when stored on repair verification results.
  - `/incidents` now includes a compact repair metrics and promotion-policy summary.
  - Promotion remains explicitly not eligible until there is enough successful repair history, no recent repair failures or possible post-ship regression incidents, and safe-restart-only live updates.
- Phase 5D Discord operator actions shipped:
  - Added `/incident approve-ship` for explicit guarded main update approval, with optional safe restart.
  - Added `/incident request-restart` as a Discord shortcut that still reuses the guarded `doctor:ship` server-side checks and safe-restart without `--force`.
  - `/incident view` now lists the guarded ship and restart commands when the incident status allows them.

## Next Development Plan: Scheduled Doctor And Self-Repair

### Target Behavior

MiniClaw should run Auto Doctor automatically every two hours by default, skip interval scans when MiniClaw logs have not changed since the previous scan, detect actionable incidents, attempt policy-allowed self-repair in an isolated workspace, and post a concise result summary to the Discord `#miniclaw-auto-improve` channel.

The initial self-repair target is guarded automation, not blind self-modification. Diagnosis can run automatically. Repair can run automatically only for allowlisted, low-risk MiniClaw code bugs. Shipping to `main` and live restart should remain conservative until the repair loop has enough successful history.

### Channel And Trigger Configuration

Add explicit doctor config instead of hardcoding the channel name:

- `doctor.enabled`: default `true`
- `doctor.auto_diagnose_enabled`: default `false` for first rollout, then enable in local config after smoke tests
- `doctor.scan_interval_ms`: default `7200000`
- `doctor.summary_channel_id`: optional Discord channel id for repair summaries; when present it wins over name lookup
- `doctor.summary_channel_name`: Discord channel name for Auto Doctor/Auto Improve summaries, default `miniclaw-auto-improve`
- `doctor.auto_repair_enabled`: default `false`
- `doctor.auto_commit_enabled`: default `true`; only applies after `doctor.auto_repair_enabled` allows an execute repair
- `doctor.auto_push_enabled`: default `false`
- `doctor.auto_restart_enabled`: default `false`
- `doctor.max_repairs_per_day`: default `2`
- `doctor.max_parallel_repairs`: default `1`
- `doctor.max_patch_files`: default `8`
- `doctor.repair_commit_author_name`: default `yuanyunfan`
- `doctor.repair_commit_author_email`: default `59247355+yuanyunfan@users.noreply.github.com`
- `doctor.require_approval_for_main`: default `true`
- `doctor.allowed_paths`: default allowlist for low-risk MiniClaw source/test/docs paths
- `doctor.blocked_paths`: secrets, runtime state, local DB, logs, `.env`, user config, package manager auth files

The scheduled trigger should be implemented as a built-in runtime scheduler, not as a user YAML cron job. The doctor loop is MiniClaw operations infrastructure, so it needs access to incident persistence, repair policy, and alert state without being mixed into normal user cron jobs.

### Phase 2A: Incident Persistence And Deduplication

Add DB-backed incident storage before any repair logic:

1. Increase the DB schema version and add `incidents`, `incident_events`, and `repair_runs`.
2. Add typed store functions:
   - `createOrUpdateIncident`
   - `listOpenIncidents`
   - `getIncident`
   - `appendIncidentEvent`
   - `markIncidentStatus`
   - `createRepairRun`
   - `updateRepairRun`
3. Use deterministic dedupe keys so the scheduled scan does not spam duplicate incidents:
   - task incidents: `task:<task_id>:<status>`
   - cron incidents: `cron:<job_name>:<failure_run_id or last_run_at>`
   - PM2 restart loop: `pm2:<app>:<restart_window>`
   - connectivity outage: `connectivity:<status>:<hour_bucket>`
4. Add open incident counts to `/health`.
5. Add `/incidents` and `/incident id:<id>` as read-only operator views.

Exit criteria:

- Repeated scheduled scans update the same open incident instead of creating duplicates.
- `/health` reports open incident count.
- No code repair path exists yet.

### Phase 2B: Scheduled Auto Doctor Loop

Add `src/ops/doctor-scheduler.ts` and start it from `src/index.ts` after Discord `clientReady`.

Loop behavior:

1. Skip when MiniClaw is draining.
2. Skip if another doctor scan is active.
3. For interval scans, skip when the MiniClaw log fingerprint is unchanged since the previous scan.
4. Run read-only doctor evidence collection for recent task, cron, PM2, logs, and connectivity state.
5. Create or update incidents through the persistence layer.
6. For newly opened or severity-escalated incidents, post a short diagnosis to the configured Auto Improve summary channel.
7. For repair-eligible incidents, enqueue a repair attempt only if `doctor.auto_repair_enabled` is true.

The scheduled diagnosis message should go to `#miniclaw-auto-improve` only when there is something actionable. A clean scheduled scan should remain log-only or send a compact daily digest later, otherwise the monitor channel becomes noisy.

Exit criteria:

- Synthetic cron/task failures create incidents on the next scan.
- Clean scans do not spam Discord.
- Drain state stops the doctor loop from starting new repair work.

### Phase 3A: Self-Repair Worker

Add a separate worker CLI:

```bash
pnpm run doctor:repair -- --incident <incident-id>
pnpm run doctor:repair -- --incident <incident-id> --dry-run
pnpm run doctor:repair -- --incident <incident-id> --json
```

Worker responsibilities:

1. Load incident, evidence, diagnosis, policy, and current Git state.
2. Refuse blocked categories:
   - provider auth/session/cookie/secret issues
   - missing third-party data
   - network/Discord outage without a MiniClaw code signal
   - dirty main worktree when no isolated worktree can be created
3. Create an isolated worktree under:

```text
~/ProjectRepo/miniclaw-repairs/<incident-id>
```

4. Create a repair branch such as:

```text
doctor-repair/<incident-id>
```

5. Generate a strict repair prompt that includes:
   - incident summary
   - evidence bundle
   - allowed and blocked paths
   - expected tests
   - safety rules
   - requirement to keep the patch small
6. Run the coding agent inside the isolated worktree.
7. Collect changed files, patch stats, test output, and final report.
8. Persist the repair run status and post a summary to `#miniclaw-auto-improve`.

The worker should not modify the live main worktree directly. The main bot should only enqueue or spawn this worker and observe its result.

Exit criteria:

- A synthetic incident can produce a dry-run repair plan.
- A safe fixture bug can produce a patch in an isolated worktree.
- Failed verification leaves the repair branch and report available for inspection.

### Phase 3B: Verification And Commit Policy

Add a repair verifier that runs staged gates in increasing cost order:

1. `pnpm run quality:g0`
2. `pnpm run quality:secrets`
3. targeted Vitest command selected by changed files
4. `pnpm run typecheck`
5. `pnpm run lint`
6. `pnpm test`
7. `pnpm run build`

Commit policy:

- Allow auto commit on the repair branch only when all required gates pass.
- Commit author must be the personal project author.
- Commit body must include `Co-authored-by: Codex <codex@openai.com>`.
- Do not auto push to `main` in this phase.
- Auto push to the repair branch can be enabled later with `doctor.auto_push_enabled`.

Exit criteria:

- Passing repair creates a commit on `doctor-repair/<incident-id>`.
- Failing repair records exact failed gate and does not commit.
- Forbidden path changes are rejected before commit.

### Phase 4: Guarded Ship And Live Update

This phase should be opt-in after Phase 3 has real successful runs.

Allowed ship flow:

1. Push repair branch.
2. Post summary to `#miniclaw-auto-improve` with:
   - incident id and title
   - likely root cause
   - changed files
   - verification gates
   - commit SHA
   - branch name
   - whether live restart was attempted
3. Main-branch update requires explicit approval unless `doctor.require_approval_for_main=false`.
4. Live restart must use `pnpm safe-restart --json`.
5. If active tasks exist, restart is refused and the Discord summary should say the patch is shipped but live update is pending.

Exit criteria:

- No repair path can hard-restart MiniClaw while tasks are running.
- `#miniclaw-auto-improve` receives a complete audit summary for each repair attempt.
- Operator can approve or manually merge/restart from the repair report.

### Phase 5: Reliability, Observability, And Operator UX

Phase 5 should not relax the `main` update or live restart approval boundary yet. After Phase 4B, the system can already produce, push, and ship guarded repair branches. The next goal is to make the repair loop easier to understand, audit, retry, and improve before considering more automatic production updates.

#### Phase 5A: Incident Detail And Lifecycle Operations

Turn incidents into a first-class Discord operator surface:

1. Add a complete `/incident id:<incident-id>` detail view.
2. Show incident status, severity, category, subject, source metadata, diagnosis, evidence summary, and latest events.
3. Link related task id, cron job, Discord thread, repair run, branch, commit SHA, ship status, and restart result when available.
4. Add guarded lifecycle operations:
   - `resolve`: mark a fixed or no-longer-relevant incident as resolved.
   - `ignore`: suppress a non-actionable incident without deleting evidence.
   - `retry repair`: enqueue a new repair attempt only when policy still allows it.
   - `ship preview`: show the exact `doctor:ship` command and dry-run output when a repair is ready or pushed.
5. Keep every operation as an `incident_events` row.

Exit criteria:

- `/incident id:<id>` gives enough evidence to decide whether the diagnosis and repair proposal are trustworthy.
- Resolved and ignored incidents no longer appear in the default open incident list.
- Retry actions do not bypass repair policy, dirty-worktree checks, or approval gates.

#### Phase 5B: TaskReporter And Normalized Trace

Improve Auto Doctor diagnosis quality by recording structured task events instead of relying mainly on log text:

1. Introduce a `TaskViewEvent` or equivalent normalized event shape.
2. Add a `TaskReporter` boundary between task execution and Discord rendering.
3. Record key task lifecycle events:
   - accepted/rejected because draining
   - smart router decision
   - context and metadata capture
   - tool/provider invocation start and finish
   - provider/auth/data/network errors
   - Discord send/edit failures
   - cancellation, interruption, completion, and recovery notices
4. Store a compact trace reference on task rows or in a dedicated trace table.
5. Let incident detection consume structured trace events before falling back to raw logs.

Exit criteria:

- A failed Discord task can be diagnosed from structured trace data without manually reading the full process log first.
- Auto Doctor reports distinguish MiniClaw bugs from provider data/auth/network/user-prompt failures more reliably.
- Discord progress/final-message rendering becomes a consumer of task events rather than a source of runtime logic.

#### Phase 5C: Repair Quality Metrics And Promotion Policy

Add reliability metrics before relaxing approval settings:

1. Track repair attempts by incident type, category, changed file count, gate duration, and final outcome.
2. Track whether shipped repairs later create regression incidents.
3. Add a repair history summary to `/doctor` or `/incidents`.
4. Define promotion policy for any future reduction of `doctor.require_approval_for_main`:
   - minimum successful repair count
   - no recent regression incidents
   - only specific allowlisted paths
   - small patch size
   - full quality gates passed
   - no active tasks when restart is requested

Exit criteria:

- The operator can see whether Auto Doctor repairs are actually reliable over time.
- There is a documented, measurable reason before any approval gate is weakened.
- Blind automatic `main` update or forced restart remains forbidden.

#### Phase 5D: Discord Operator Actions

Make the existing guarded flow easier to execute from `#miniclaw-auto-improve`:

1. Add Discord components or clear slash-command shortcuts for:
   - view incident
   - retry repair
   - preview ship
   - approve guarded ship
   - request safe restart
2. Require explicit approval for operations that affect `main` or the live PM2 app.
3. Re-run the same server-side policy checks used by CLI scripts; Discord UI must not become a bypass.
4. Post a concise operation summary back to `#miniclaw-auto-improve`.

Exit criteria:

- The operator can move from alert to diagnosis to repair preview to guarded ship without leaving Discord for routine cases.
- Main update and restart still require explicit action and still respect safe restart refusal when tasks are running.

#### Later: Incident Board Or Dashboard

A Web dashboard is not the next priority. Add it only after Discord incident operations and structured trace data exist, and only if cross-incident search, provider health boards, or longer repair history views become painful in Discord.

### Recommended First Implementation Slice

Implement in this order:

1. Config keys and `#miniclaw-auto-improve` summary channel resolution.
2. Incident persistence and dedupe.
3. Scheduled read-only doctor loop.
4. Discord notification for new or escalated incidents.
5. Self-repair dry-run worker.
6. Isolated worktree repair worker with verification.
7. Auto commit to repair branch. Shipped.
8. Optional branch push. Shipped.
9. Safe restart approval flow. Shipped as guarded `doctor:ship`.
10. `/incident id:<id>` detail view with repair/ship history. Shipped.
11. Incident lifecycle operations: resolve, ignore, retry repair, and ship preview. Shipped.
12. `TaskReporter` and normalized task trace events. Shipped.
13. Repair reliability metrics and promotion policy. Shipped.
14. Discord operator actions for the guarded repair/ship flow. Shipped.

The remaining optional follow-up is the incident board/dashboard. It should stay out of the next implementation slice unless Discord incident review or cross-incident search becomes painful enough to justify a UI.
