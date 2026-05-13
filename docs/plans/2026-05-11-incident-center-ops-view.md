# Incident Center Operator View

Status: done
Date: 2026-05-11

## Background

MiniClaw already has a meaningful Auto Doctor foundation:

- `/doctor`
- `/incidents`
- `/incident view`
- `/incident resolve`
- `/incident ignore`
- `/incident retry-repair`
- `/incident ship-preview`
- `/incident approve-ship`
- guarded repair worker
- guarded ship path
- safe restart boundary

The remaining gap is operator continuity. From one incident id, the user should be able to trace the original task/cron/log evidence, task trace, repair run, ship preview, restart decision, blockers, rollback command, and post-ship monitoring state.

## Goals

- Strengthen `/incident view` into a compact operator detail view.
- Add incident search/filter by type, category, route, provider, repair status, and severity.
- Add repair branch review report with diff summary, changed paths, verification commands, risks, and rollback command.
- Link incidents to task trace, cron run detail, repair run detail, ship preview, and restart status.
- Keep the main MiniClaw process read-only for diagnosis; repair writes stay in isolated worktrees.

## Non-Goals

- Do not create a web dashboard in this slice.
- Do not auto-update `main` or restart production without explicit approval.
- Do not expose raw evidence bundles, prompts, credentials, cookies, or account data in Discord.
- Do not make the main bot process modify source files.
- Do not replace `doctor:repair` or `doctor:ship`; improve their review surfaces.

## Existing Architecture Evidence

- `src/commands/register.ts`: incident slash commands are already registered.
- `src/commands/handlers.ts`: handles `/incidents` and `/incident` subcommands.
- `src/commands/incident-detail.ts`: formats incident detail text.
- `src/store/incidents.ts`: incident, incident event, and repair run repositories.
- `src/ops/doctor.ts`: evidence collection and diagnosis.
- `src/ops/doctor-scheduler.ts`: scheduled diagnosis, notifications, repair attempts.
- `src/ops/doctor-repair.ts`: isolated worktree repair flow and repair reports.
- `src/ops/doctor-ship.ts`: guarded ship and optional safe restart.
- `docs/zh/13-auto-doctor.zh.md`: current Auto Doctor user-facing docs.
- `docs/plans/2026-05-10-miniclaw-auto-doctor-self-repair.md`: original self-repair loop plan.

## Target User Experience

### `/incidents`

Support optional filters:

- `status`
- `type`
- `severity`
- `category`
- `provider`
- `route`
- `repair_status`
- `limit`

Default remains open incidents only.

Output should be grouped and compact:

- headline count
- top severity/type groups
- incident rows with short id, severity/status, type, subject, updated age, repair state
- command hints

### `/incident view id:<prefix>`

Add sections when data exists:

- core incident facts
- source subject
- diagnosis summary
- linked task trace command if subject is task
- linked cron run command if subject is cron and cron run history exists
- recent incident events
- repair run summary
- ship preview state
- restart status
- blockers
- rollback command or revert instructions
- next recommended operator action

### Repair Review Report

Add a reusable formatter for repair review:

- incident id and title
- repair branch and commit
- base SHA
- changed files
- diff summary
- verification commands and exit status
- blocked paths result
- risks and rollback command
- ship/restart commands

Expose via:

- `pnpm run doctor:ship -- --incident <id>` dry-run output
- `/incident ship-preview`
- maybe `/incident repair-report id:<id>` if `/incident view` becomes too long

## Data Model Additions

Prefer using existing `repair_runs.report_json` and `verification_json` first.

If missing fields are needed, add nullable fields later:

- `repair_runs.diff_summary_json`
- `repair_runs.changed_files_json`
- `repair_runs.rollback_command`
- `repair_runs.ship_blockers_json`
- `repair_runs.post_ship_monitoring_json`

Do not add schema fields until the formatter proves the current stored JSON cannot support it.

## Implementation Plan

1. Inventory current incident and repair JSON payloads.
   - Use tests and local dry-run outputs; do not inspect private live data in docs.
2. Add incident filter store helpers.
   - Extend `listOpenIncidents` or add `listIncidents(filters)`.
   - Keep id-prefix resolution unchanged.
   - Add tests for filters and sorting.
3. Extend `/incidents`.
   - Add optional filter args in `src/commands/register.ts`.
   - Implement filter parsing in `src/commands/handlers.ts`.
   - Keep output under Discord limits.
4. Improve `formatIncidentDetail`.
   - Add linked command hints:
     - `/task-log id:<task-prefix>` when available;
     - future `/cron-run id:<run-id>` when cron history exists;
     - `pnpm run doctor:ship -- --incident <id>` for local preview.
   - Add repair state and blockers from latest repair run.
5. Add repair review formatter.
   - Candidate file: `src/commands/repair-review.ts` or `src/ops/doctor-repair-report.ts`.
   - Use it from `doctor:ship` dry-run and Discord ship preview if possible.
6. Add post-ship monitoring hints.
   - After successful ship/restart, incident events should record main update and restart attempt.
   - View should show those events and next check command, not auto-run monitoring unless already configured.
7. Reuse task trace exporter once implemented.
   - If trace exporter has not landed, add only command hints and keep this item in execution notes.
8. Add tests.
   - Incident filter tests.
   - Incident detail formatting tests.
   - Repair review formatter tests.

## Verification Plan

- Focused:
  - `pnpm vitest run src/store/__tests__/incidents.test.ts`
  - `pnpm vitest run src/commands/__tests__/incident-detail.test.ts`
  - Add repair review tests if implemented.
- Static:
  - `pnpm run typecheck`
  - `pnpm run lint`
- Full:
  - `pnpm test`
- Optional local smoke:
  - `pnpm run doctor -- --json`
  - `pnpm run doctor:ship -- --incident <test-incident> --json` when a safe test incident exists.

## Risks And Rollback

- Risk: incident view exceeds Discord message limits.
  - Mitigation: keep detail sections compact; use attached Markdown only if redaction and size handling are ready.
- Risk: filters produce misleading empty output.
  - Mitigation: include active filter summary and examples.
- Risk: repair report leaks diff content from sensitive files.
  - Mitigation: show changed paths and summary by default; avoid raw diff in Discord.
- Risk: operator commands imply auto-approval.
  - Mitigation: copy should state approval boundary; ship/restart commands remain explicit.

## Documentation Sync

- Update `docs/zh/13-auto-doctor.zh.md`.
- Update `docs/architecture.md` if incident data model or command surface changes.
- Update `docs/bot-routing.md` if slash command behavior changes materially.
- Run `pnpm run quality:docs`.

## Execution Notes

Record new filters, formatter behavior, command output examples, and verification evidence here when implemented.

### 2026-05-13 - Ralph incident list filters

- Implemented the first reviewable phase: `/incidents` now supports optional `status`, `type`, `severity`, `category`, `provider`, `route`, `repair_status`, and `limit` filters while preserving the default open-status-set behavior.
- Added `listIncidents(filters, limit)` and `countIncidents(filters)` in `src/store/incidents.ts`; category/provider/route are read from existing JSON payloads, and `repair_status` matches the latest `repair_runs.status`. No schema fields were added.
- Added compact incident list formatting in `src/commands/incidents.ts`: active filter summary, severity/type groups, rows with short id, severity/status, type, latest repair state, updated age, subject, source route/provider when present, and operator hints.
- Wired the slash command options in `src/commands/register.ts` and `handleIncidents` in `src/commands/handlers.ts`.
- Updated docs in `docs/features/13-auto-doctor.md`, `docs/bot-routing.md`, and `docs/architecture.md` for the new filter surface and store query behavior.
- Focused verification passed:
  - `pnpm vitest run src/store/__tests__/incidents.test.ts src/commands/__tests__/incidents.test.ts src/commands/__tests__/incident-detail.test.ts` - 13 tests passed.
  - `pnpm run typecheck` - passed.
  - `pnpm run lint` - passed.
  - `pnpm run quality:docs` - passed after architecture docs were synced.
- Ralph doctor profile passed:
  - `pnpm run ralph:verify -- --task incident-center-ops-view --profile doctor` - passed; included doctor scheduler/repair/ship tests, incident detail tests, typecheck, lint, and docs drift.
- Remaining plan items: richer `/incident view` links, repair review formatter, post-ship monitoring hints, and future cron/task trace deep links beyond this list-filter phase.

### 2026-05-13 - Ralph operator detail view

- Implemented the next reviewable phase: `/incident view` now builds a compact operator detail view with core facts, diagnosis, source metadata, task trace, linked cron runs, latest repair review fields, ship/restart state, rollback hint, next action, operator commands, and recent events.
- Added `listCronRunsForIncident(incidentId, limit)` in `src/store/cron-runs.ts` and wired `handleIncident(view)` to pass linked cron run history for cron incidents. No schema fields were added; the link uses existing `cron_runs.incident_id`.
- Expanded latest repair rendering from existing `repair_runs.report_json` and `verification_json`: changed files, blockers, commit/push errors, and verification command statuses are displayed only when recorded, keeping the Discord output under the 1900 character guard.
- Added ship/restart continuity from recent incident events: ship preview request, main update, live restart completed/deferred/failed, pre-ship vs shipped rollback hints, and a next recommended operator action based on current status and latest repair state.
- Updated docs in `docs/features/13-auto-doctor.md`, `docs/bot-routing.md`, and `docs/architecture.md` for the richer operator view and cron-run link behavior.
- Focused verification passed:
  - `pnpm vitest run src/commands/__tests__/incident-detail.test.ts src/commands/__tests__/incidents.test.ts src/store/__tests__/cron-runs.test.ts` - 16 tests passed.
  - `pnpm run typecheck` - passed.
  - `pnpm run lint` - passed.
  - `pnpm run quality:docs` - passed.
- Ralph doctor profile passed:
  - `pnpm run ralph:verify -- --task incident-center-ops-view --profile doctor` - passed; included doctor scheduler/repair/ship tests, incident detail tests, typecheck, lint, and docs drift.
- Remaining plan items: standalone reusable repair review formatter for `doctor:ship` dry-run/ship-preview, and future trace exporter deep links beyond the command hints already shown in `/incident view`.

### 2026-05-13 - Ralph shared repair review report

- Implemented the next reviewable phase: `doctor:ship` dry-run/execute formatting now uses a reusable repair review formatter built from existing `repair_runs.report_json` and `verification_json`; no schema fields were added.
- Added `formatRepairReviewReport` in `src/ops/doctor-repair/report.ts` and wired `formatDoctorShipResult` to it, so local `pnpm run doctor:ship -- --incident <id>` and Discord `/incident ship-preview` share the same report body.
- The review report now includes incident identity, ship state, repair branch and commit/base SHA, changed paths, diff summary when recorded, verification commands with inferred exit status, path-policy blockers, risks, rollback instructions, and local/Discord ship commands.
- The formatter uses the shared diagnostic redaction policy before printing stored report fields and keeps the Discord path on changed paths/summaries rather than raw diffs.
- Updated docs in `docs/features/13-auto-doctor.md` and `docs/bot-routing.md` for the shared dry-run/ship-preview review surface.
- Focused verification passed:
  - `pnpm vitest run src/ops/__tests__/doctor-ship.test.ts` - 8 tests passed.
  - `pnpm run typecheck` - passed.
  - `pnpm run lint` - passed.
  - `pnpm run quality:docs` - passed.
- Ralph doctor profile passed:
  - `pnpm run ralph:verify -- --task incident-center-ops-view --profile doctor` - passed; included doctor scheduler/repair/ship tests, incident detail tests, typecheck, lint, and docs drift.
- Remaining plan item: future trace exporter deep links beyond the command hints already shown in `/incident view`.

### 2026-05-13 - Ralph incident task trace continuity

- Implemented the final reviewable phase: `/incident view` now resolves a task trace context from the incident subject, linked `cron_runs.task_id`, or source metadata `task_id`, then shows the safe task trace exporter summary and latest compact redacted event lines when available.
- Added `formatTaskTraceCompactEvents` in `src/store/task-trace-export.ts` so incident detail reuses the existing trace projection/redaction boundary instead of rendering raw task event payloads.
- Kept the Discord detail compact: the `Task Trace` section now shows the resolved source, exporter availability, full `/task-log` command, and the incident evidence trace slice when present; full Markdown export stays behind `/task-log` / `pnpm run task:trace`.
- Wired `handleIncident(view)` to build and pass the trace context for both direct task incidents and cron incidents with linked task runs. No schema fields were added.
- Updated docs in `docs/features/13-auto-doctor.md`, `docs/bot-routing.md`, and `docs/architecture.md` for the shared trace-exporter summary behavior.
- Focused verification passed:
  - `pnpm vitest run src/commands/__tests__/incident-detail.test.ts src/commands/__tests__/incidents.test.ts src/store/__tests__/task-trace-export.test.ts` - 16 tests passed.
  - `pnpm run typecheck` - passed.
  - `pnpm run lint` - passed.
  - `pnpm run quality:docs` - passed.
- Ralph doctor profile passed:
  - `pnpm run ralph:verify -- --task incident-center-ops-view --profile doctor` - passed; included doctor scheduler/repair/ship tests, incident detail tests, typecheck, lint, and docs drift.
- All implementation plan items are now complete and verified; plan status is `done`.
