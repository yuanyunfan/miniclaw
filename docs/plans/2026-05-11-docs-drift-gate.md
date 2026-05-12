# Docs Drift Quality Gate Expansion

Status: done
Date: 2026-05-11

## Background

MiniClaw is a docs-first project. `pnpm run quality:docs` currently checks a first slice of D1 invariants: DB schema version, selected Smart Router ER fields, and `docs/features/*.md` index coverage.

The remaining gap is changed-path semantics. When source paths change, the relevant source-of-truth docs should either change in the same commit or the developer should record an explicit reason for deferring docs updates.

## Goals

- Extend `quality:docs` with changed-path to required-docs mapping.
- Keep the gate lightweight and deterministic.
- Support staged mode for pre-commit and tree/range mode for CI/pre-push.
- Avoid treating archived plan docs as current source of truth.
- Make docs drift failures actionable by printing exact changed source paths and expected docs paths.

## Non-Goals

- Do not require every code change to update docs.
- Do not parse semantic diffs deeply in the first slice.
- Do not build a general documentation linter.
- Do not make old `docs/plans/*.md` files mandatory sync targets.
- Do not block emergency hotfixes without an override mechanism.

## Existing Architecture Evidence

- `scripts/quality-docs.ts`: current D1 script.
- `package.json`: `quality:commit` and `quality:push` both run `quality:docs`.
- `docs/quality-gates.md`: lists D1 mapping expectations such as `src/bot.ts` to `docs/bot-routing.md`.
- `docs/architecture.md`: source of truth for DB schema, cron, task runtime, config, and user-level layout.
- `docs/bot-routing.md`: source of truth for Discord routing.
- `docs/prompts.md`: source of truth for prompt templates.
- `docs/features/*.md`: feature-level source-of-truth docs.

## Mapping Proposal

Start with a conservative map:

- `src/bot.ts`, `src/commands/**`, `src/discord/**`, `src/routing/**`
  - require one of:
    - `docs/bot-routing.md`
    - `docs/chat-router-current-logic.md`
    - relevant `docs/features/*.md`
- `src/agent/**`
  - require one of:
    - `docs/architecture.md`
    - `docs/features/03-discord-task-output.md`
    - relevant runtime/agent feature doc
- `src/cron/**`, `scripts/cron-*`
  - require one of:
    - `docs/architecture.md`
    - relevant cron/provider feature doc
- `src/store/db.ts`, `src/store/**`
  - require `docs/architecture.md`
  - if Smart Router store changes, also require `docs/bot-routing.md` or router feature doc
- `src/providers/**`
  - require relevant provider feature doc or provider framework doc
- `src/config.ts`, `config.example.yaml`
  - require `docs/architecture.md` or config/provider/runtime feature doc
- `prompts/**`, `src/agent/prompts.ts`
  - require `docs/prompts.md` and prompt snapshot tests
- `scripts/quality-*`, `.github/workflows/**`, `scripts/git-hooks/**`
  - require `docs/quality-gates.md`
- `src/ops/doctor*`, `scripts/doctor*`
  - require `docs/zh/13-auto-doctor.zh.md` or Auto Doctor plan/doc
- `src/stage/**`
  - require Stage doc only if Stage behavior is intended to be source-of-truth, otherwise allow with experimental-boundary note.

## Override Proposal

Support an explicit checked-in marker file only if needed:

- `docs/drift-waivers.md` is too easy to abuse and can drift.
- Prefer commit-body notes for human process, but scripts cannot read commit body during pre-commit.
- Better first slice: allow a small environment variable for local emergency use:
  - `MINICLAW_DOCS_DRIFT_ALLOW=1 pnpm run quality:docs`
  - CI should not set this.

For normal work, the right fix is to update the mapped doc or add a new source-of-truth doc and index it.

## Implementation Plan

1. Refactor `scripts/quality-docs.ts`.
   - Keep existing invariant checks.
   - Add helper functions:
     - `getChangedPaths(mode)`
     - `matchDocRequirements(changedPaths)`
     - `hasRequiredDocChange(requirement, changedPaths)`
   - Keep output concise and actionable.
2. Decide changed path source.
   - For pre-commit: use staged paths from `git diff --cached --name-only`.
   - For normal `pnpm run quality:docs`: if staged paths exist, use staged; otherwise use working tree changed paths from `git diff --name-only HEAD` plus untracked non-ignored files.
   - For CI: optionally support `--base <sha>` later; first slice can rely on full invariant checks plus changed path detection in local hooks.
3. Add mapping config in code.
   - Keep a simple constant array in `scripts/quality-docs.ts` first.
   - If it grows, move to `scripts/docs-drift-map.ts`.
4. Avoid false positives for plan-only changes.
   - Changes under `docs/plans/**` should not require source docs.
   - Changes under `docs/continuous-improvement-report.md` should not require docs sync.
5. Add tests or testable helpers.
   - Extract pure helpers into importable module if needed.
   - Test representative path sets and expected required docs.
6. Update `docs/quality-gates.md`.
   - Document the current mapping, limitations, and emergency override.
7. Run on current tree.
   - Ensure existing clean tree passes.
   - Simulate a changed source path without docs in a temp git worktree only if feasible.

## Verification Plan

- Focused:
  - Add tests for mapping helpers if extracted.
  - Run `pnpm run quality:docs`.
- Static:
  - `pnpm run typecheck`
  - `pnpm run lint`
- Regression:
  - `pnpm run quality:commit` if runtime is acceptable.
- Manual simulation:
  - Temporarily edit a mapped source file and no docs; verify `quality:docs` fails.
  - Add the mapped doc change; verify it passes.
  - Revert the temporary simulation before finalizing.

## Risks And Rollback

- Risk: noisy false positives slow down small fixes.
  - Mitigation: start with high-value mappings only and clear output.
  - Rollback: disable changed-path mapping while keeping existing invariant checks.
- Risk: script behavior differs between pre-commit and CI.
  - Mitigation: document mode selection and add explicit flags only when needed.
- Risk: developers update irrelevant docs to satisfy the gate.
  - Mitigation: error output should name acceptable source-of-truth docs, not any docs file.
- Risk: archived plans become treated as current docs.
  - Mitigation: exclude `docs/plans/**` from satisfying requirements unless explicitly listed.

## Documentation Sync

- Update `docs/quality-gates.md` D1 section.
- Update `docs/README.md` only if adding a new source-of-truth docs page.
- Keep plan docs as execution artifacts, not the source of current behavior.

## Execution Notes

Implemented on 2026-05-12.

Final behavior:

- Added testable changed-path mapping helpers in `src/quality/docs-drift.ts`; `scripts/quality-docs.ts` now keeps the fixed D1 invariant checks and wires git changed-path collection into those helpers.
- `quality:docs` defaults to staged paths when any staged path exists; otherwise it checks `git diff HEAD` plus untracked non-ignored paths. It also supports `--staged`, `--tree`, `--base <ref> [--head <ref>]`, `MINICLAW_DOCS_DRIFT_BASE`, and `MINICLAW_DOCS_DRIFT_HEAD`.
- `MINICLAW_DOCS_DRIFT_ALLOW=1` bypasses only changed-path mapping failures. Schema version, Smart Router ER fields, and feature-doc index invariants still fail normally.
- Ignored source triggers: `docs/plans/**`, `docs/continuous-improvement-report.md`, `docs/private/**`, tests, specs, and fixtures. Plan docs are not accepted as source-of-truth docs for mapped source changes.

Final mapping:

- `src/bot.ts`, `src/commands/**`, `src/discord/**`, `src/routing/**` -> one of `docs/bot-routing.md`, `docs/chat-router-current-logic.md`, `docs/features/*.md`.
- `src/agent/**` except `src/agent/prompts.ts` -> one of `docs/architecture.md`, `docs/features/03-discord-task-output.md`, `docs/features/*.md`.
- `src/cron/**`, `scripts/cron-*` -> one of `docs/architecture.md`, `docs/features/*.md`.
- `src/store/db.ts`, `src/store/**` -> `docs/architecture.md`.
- `src/providers/**` -> one of `docs/architecture.md`, `docs/features/*.md`.
- `src/config.ts`, `config.example.yaml` -> one of `docs/architecture.md`, `docs/features/*.md`.
- `prompts/**`, `src/agent/prompts.ts` -> `docs/prompts.md` and `src/__tests__/prompt-snapshot.test.ts`.
- `scripts/quality-*`, `src/quality/**`, `.github/workflows/**`, `scripts/git-hooks/**` -> `docs/quality-gates.md`.
- `src/ops/doctor*`, `scripts/doctor*` -> `docs/features/13-auto-doctor.md`.
- `src/stage/**` -> `docs/features/01-stage.md`.

Documentation sync:

- Updated `docs/quality-gates.md` D1 section with the scripted mapping, mode selection, ignored paths, and emergency local override.
- No new source-of-truth docs page was added, so `docs/README.md` did not need a new index entry.

Verification evidence:

- `pnpm vitest run src/quality/__tests__/docs-drift.test.ts` -> passed, 9 tests.
- `pnpm run typecheck` -> passed.
- `pnpm run lint` -> passed.
- `pnpm run quality:docs` on the final worktree -> passed: 15 feature docs, schema v9, 5 changed paths, 1 mapped rule, `tree(auto)`.
- Manual simulation source-only failure: temporary `src/bot.ts` change without routing docs failed with actionable output naming `src/bot.ts` and expected `docs/bot-routing.md`, `docs/chat-router-current-logic.md`, or `docs/features/*.md`.
- Manual simulation source + docs pass: temporary `src/bot.ts` plus `docs/bot-routing.md` changes passed; both temporary changes were reverted.
- `pnpm test` full suite first run hit an unrelated concurrent sqlite lock in `src/discord/__tests__/task-view-reporter.test.ts`; the run otherwise reported 127 passed test files, 634 passed tests, and 8 skipped tests. Rerunning `pnpm vitest run src/discord/__tests__/task-view-reporter.test.ts` passed 8 tests.
- `pnpm ralph:verify -- --task docs-drift-gate` -> passed docs profile (`pnpm run quality:docs`, `pnpm run lint`).
