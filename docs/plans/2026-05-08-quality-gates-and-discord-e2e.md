# Quality Gates And Discord E2E Implementation

Status: in_progress
Date: 2026-05-08

## Background

`docs/quality-gates.md` defines MiniClaw's quality system as `G0/G1/G2 + L1/L2/L3/L4 + D1`.
The current repo already has TypeScript strict mode, Vitest, coverage, and a pre-commit hook that runs only `tsc --noEmit`.
The immediate gap is that these checks are not wired into a consistent local and CI gate.

MiniClaw also handles Discord, cron, local `~/.miniclaw` config, secrets, broker providers, and LLM providers, so the first implementation must prioritize fast, deterministic checks before adding real Discord E2E.

## Goals

- Implement `P0-00` through `P0-04` first.
- Add stable npm scripts for commit and push quality gates.
- Add a G0 staged/tree safety script for common secret and artifact mistakes.
- Strengthen `pre-commit` and add `pre-push`.
- Add a basic GitHub Actions workflow on Node 22.
- Keep real Discord E2E as an explicit later slice.

## Non-Goals

- Do not introduce ESLint in this slice; that belongs to `P1-01`.
- Do not introduce gitleaks or dependency scanning in this slice; those belong to `P1-02` and `P1-03`.
- Do not implement the full Discord E2E harness in this slice; that belongs to `P0-07`.
- Do not call real Claude/Codex, real Discord, or real cron during commit/push by default.

## Existing Architecture Evidence

- `package.json`: has `build`, `test`, `test:cov`, but no `typecheck`, `quality:commit`, `quality:push`, or `e2e:discord`.
- `scripts/git-hooks/pre-commit`: currently runs only `pnpm exec tsc --noEmit`.
- `src/__tests__/prompt-snapshot.test.ts`: existing L1 prompt snapshot coverage.
- `.github/`: not present before this slice.
- `docs/quality-gates.md`: defines P0/P1/P2 implementation order.

## Implementation Plan

1. Add `scripts/quality-g0.ts`.
   - Check Node major version against `package.json` engines.
   - Scan staged or tracked files for blocked private paths and high-confidence secret patterns.
   - Guard package dependency changes so dependency edits stage `pnpm-lock.yaml`.
2. Update `package.json`.
   - Add `typecheck`.
   - Add `quality:g0`, `quality:g0:staged`, `quality:commit`, `quality:push`.
   - Add `e2e:discord` as a placeholder entry for the later P0 Discord harness.
3. Update git hooks.
   - `pre-commit` runs `quality:commit`.
   - Add `pre-push` running `quality:push`, and run Discord E2E only when `MINICLAW_RUN_DISCORD_E2E=1`.
4. Add `.github/workflows/quality.yml`.
   - Node 22.
   - pnpm frozen install.
   - G0 tree check, typecheck, test, build.

## Verification Plan

- `pnpm run quality:g0`
- `pnpm run quality:g0:staged`
- `pnpm run typecheck`
- `pnpm test`
- `pnpm run build`
- `pnpm run quality:commit`

`pnpm run quality:push` includes coverage and may take longer, so it should be run after the first pass is green.

## Risks And Rollback

- Risk: G0 secret patterns create false positives.
  - Mitigation: start with high-confidence patterns and blocked private paths only.
  - Rollback: remove or narrow the matching pattern in `scripts/quality-g0.ts`.
- Risk: pre-commit becomes too slow.
  - Mitigation: only G0 + typecheck + L1 tests are included, matching `docs/quality-gates.md`.
  - Rollback: keep `quality:commit` but remove it from the hook temporarily.
- Risk: CI setup differs from local pnpm.
  - Mitigation: pin pnpm via `packageManager`.
  - Rollback: update workflow package manager setup.

## Documentation Sync

- `docs/quality-gates.md`: remains the source of truth for the full design.
- This plan records the P0 implementation evidence.
- Future slices should append execution notes or create follow-up plan docs when moving to P0-05+.

## Execution Notes

- Started with P0-00 through P0-04 only.
- Implemented `scripts/quality-g0.ts` with staged/tree modes, blocked private paths, high-confidence secret checks, Node engine validation, and dependency lock staging guard.
- Added package scripts: `typecheck`, `quality:g0`, `quality:g0:staged`, `quality:commit`, `quality:push`, and reserved `e2e:discord`.
- Updated `scripts/git-hooks/pre-commit` and added `scripts/git-hooks/pre-push`; installed both into `.git/hooks` with `bash scripts/install-hooks.sh`.
- Added `.github/workflows/quality.yml` for Node 22, pnpm frozen install, G0, typecheck, test, and build.
- Verification passed:
  - `pnpm run quality:g0`
  - `pnpm run quality:g0:staged`
  - `pnpm run typecheck`
  - `pnpm test`
  - `pnpm run build`
  - `pnpm run quality:commit`
  - `pnpm run quality:push`
  - `pnpm install --frozen-lockfile --offline`
- Coverage report from `quality:push`: all 68 test files passed, 354 tests passed, total statement coverage 58.2%. No threshold was added in this slice.
- First G0 pass produced expected false positives for `.env.example` placeholders and `vitest.setup.ts` test token fallback; tightened assignment matching so placeholders and `process.env` fallbacks do not fail tree scans.
- G0 tree mode now scans tracked plus untracked non-ignored files locally, so newly created scripts and workflows are checked before they are staged.
- Continued with `P0-05` E2E safety configuration.
- Added E2E runtime config:
  - `MINICLAW_E2E_MODE` / `e2e.mode`.
  - `MINICLAW_E2E_SENDER_USER_IDS` / `e2e.sender_user_ids`.
  - `MINICLAW_DISABLE_SCHEDULER` / `e2e.disable_scheduler`.
  - `MINICLAW_MEMORY_PATH` / `storage.memory_path`.
- E2E mode now fails closed unless config, DB path, memory path, default cwd, and channel default cwd all resolve under the system temp directory.
- E2E mode now refuses explicit `/task cwd` paths outside the temp directory at runtime.
- Discord message author filtering now allows configured E2E sender bot IDs only when E2E mode is enabled; normal production bot messages remain ignored.
- Scheduler startup is disabled when `MINICLAW_DISABLE_SCHEDULER=true`, preventing E2E runs from reading or executing local cron jobs.
- Local P0-05 verification passed:
  - `pnpm exec vitest run src/__tests__/config.test.ts src/e2e/__tests__/safety.test.ts src/memory/__tests__/memory-md.test.ts src/memory/__tests__/inject.test.ts`
  - `pnpm run typecheck`
