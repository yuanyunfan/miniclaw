# Continuous Improvement Plan Index

Status: draft
Date: 2026-05-11

## Background

`docs/continuous-improvement-report.md` collects the next MiniClaw improvement backlog after the current code alignment pass. This index turns that report into execution-ready plan documents under `docs/plans/`.

Each linked plan is meant to be usable as the kickoff artifact for a separate Codex session. A later session should start by reading the specific plan, then verify current code state before editing because MiniClaw is changing quickly.

## Recommended Execution Order

### Track A: Task Runtime And User Visibility

1. `2026-05-11-task-view-boundary.md`
   - First priority because it reduces the blast radius of later trace, incident, and Discord output work.
   - Establishes `TaskViewEvent`, task runners, and Discord view reporter boundaries.
2. `2026-05-11-task-trace-export.md`
   - Can start from existing `task_events`, but should reuse the task view vocabulary if Track A has landed.
   - Adds `/task-log` or `/task trace` plus Markdown export.
3. `2026-05-11-smart-router-evaluation-loop.md`
   - Builds an outcome loop around router decisions, user choices, created tasks, and final task status.

### Track B: Quality And Maintainability

4. `2026-05-11-docs-drift-gate.md`
   - Expands D1 from fixed invariants to changed-path review mapping.
   - Should land early because every later architecture change needs docs sync.
5. `2026-05-11-complexity-hotspot-refactor.md`
   - Coordinates the god-module refactors.
   - Do not implement every listed refactor in one commit; treat it as a sequence of narrow slices.

### Track C: Runtime, Provider, Config, And State Frameworks

6. `2026-05-11-agent-runtime-contracts.md`
   - Separates Agent runtime, Model client, IM transport, and Data provider contracts.
   - Should inform later config and task runner refactors.
7. `2026-05-11-db-migrations-state-lifecycle.md`
   - Introduces migration modules, schema audit, repositories, retention, and redaction policy.
8. `2026-05-11-config-schema-first.md`
   - Splits config loading, schema validation, path resolution, and runtime config.
9. `2026-05-11-provider-framework-sdk.md`
   - Turns current pre-provider conventions into manifest, health, dry-run, structured output, replay fixture, and commit protocol.

### Track D: Operations Surface

10. `2026-05-11-incident-center-ops-view.md`
    - Extends existing Auto Doctor incident paths into a real operator view.
    - Depends on task trace export for the best user experience.
11. `2026-05-11-cron-run-history-control.md`
    - Adds `cron_runs`, per-job control, provider preflight, and linked diagnostics.
    - Benefits from provider framework and incident center, but can be implemented incrementally.
12. `2026-05-11-stage-experimental-boundary.md`
    - Keeps Stage explicitly experimental and prevents it from pulling the Discord bot runtime into a second product surface.

## Cross-Cutting Rules For All Follow-Up Sessions

- Start with `git status --short` and preserve unrelated user changes.
- Re-check current file structure with `rg --files` because some plans may become partially implemented by earlier sessions.
- Prefer narrow slices and atomic commits.
- Run at least `pnpm run typecheck`, `pnpm run lint`, and focused `pnpm vitest run ...` for code changes.
- Run `pnpm run quality:docs` whenever source-of-truth docs, DB schema, routing, provider contracts, or quality gates change.
- For Discord-visible behavior, use deterministic fake/E2E tests first; real Discord E2E remains manual or explicitly requested.

## Supersession Rules

These plans are draft execution plans, not permanent source of truth. When a task is implemented:

- Update the plan `Status` and `Execution Notes`.
- Update the relevant source-of-truth doc, usually `docs/architecture.md`, `docs/bot-routing.md`, `docs/quality-gates.md`, or `docs/features/*.md`.
- If behavior materially diverges from the plan, record the new decision in the plan before closing the session.

