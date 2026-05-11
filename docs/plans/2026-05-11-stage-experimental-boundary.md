# Stage Experimental Boundary

Status: draft
Date: 2026-05-11

## Background

The Stage subsystem has its own persona, orchestrator, TUI, smoke/E2E path, and CLI commands. It is useful as a playground for persona and multi-agent workflow research, but it is not the same product surface as the long-running Discord bot.

If Stage becomes deeply coupled to the Discord task runtime, MiniClaw will effectively maintain two primary UX surfaces with different assumptions. That would distract from the current priority: personal automation, private data ingestion, Discord-native delivery, runtime switching, and operations governance.

## Goals

- Explicitly mark Stage as experimental.
- Keep Stage from blocking Discord bot quality and runtime changes.
- Allow Stage to reuse `AgentRuntime` and `ModelClient` contracts when those are stable.
- Prevent Stage-specific UX, persona, or multi-agent decisions from becoming default Discord task behavior.
- Add minimal docs and tests to preserve the boundary.

## Non-Goals

- Do not delete Stage.
- Do not make Stage a core runtime path in this slice.
- Do not default MiniClaw tasks to multi-agent execution.
- Do not build full Stage docs index, health, usage accounting, or quality gates unless Stage is promoted later.
- Do not refactor Discord task runtime for Stage-only needs.

## Existing Architecture Evidence

- `package.json`: `stage` and `stage:repl` scripts exist.
- `src/stage/index.tsx`: TUI entry.
- `src/stage/repl.ts`: REPL entry.
- `src/stage/agent.ts`: provider-specific Stage agent behavior.
- `src/stage/orchestrator.ts`: Stage orchestration.
- `src/stage/personas.ts`: Stage persona definitions.
- `src/stage/e2e.ts` and `src/stage/smoke.ts`: Stage checks.
- `src/stage/__tests__/*`: existing Stage tests.
- `docs/continuous-improvement-report.md`: recommends keeping Stage experimental.

## Boundary Rules

- Stage may depend on shared low-level contracts:
  - `AgentRuntime`
  - `ModelClient`
  - logging
  - config read-only summary
  - prompt utilities
- Stage should not depend on Discord-specific task intake, button routing, or task thread rendering.
- Discord bot should not depend on Stage personas, TUI state, or Stage orchestrator.
- Stage-specific multi-agent protocols must not become the default task execution path.
- Stage docs should clearly say "experimental playground".

## Implementation Plan

1. Add or update Stage documentation.
   - Candidate doc: `docs/features/16-stage-experimental.md` or `docs/stage.md`.
   - Include:
     - purpose;
     - non-goals;
     - commands;
     - boundary with Discord bot;
     - promotion criteria if Stage ever becomes core.
2. Update docs index if adding a feature doc.
   - Add entry to `docs/README.md`.
3. Add import-boundary check if feasible.
   - Simple first slice: `scripts/quality-docs.ts` is not the right place.
   - Candidate script later: `scripts/quality-boundaries.ts`.
   - Initial check can be a Vitest static test:
     - Stage modules should not import `src/bot.ts`, `src/discord/task-intake.ts`, or Discord command handlers.
     - Discord runtime modules should not import `src/stage/*`.
4. Adapt Stage to runtime contracts only after `AgentRuntime` exists.
   - If `2026-05-11-agent-runtime-contracts.md` has not landed, do not force this.
   - Record this as a follow-up.
5. Keep Stage quality separate.
   - Existing Stage tests can remain part of normal `pnpm test`.
   - Do not add real Discord/LLM Stage E2E to commit gates.
6. Document promotion criteria.
   - Stage can become core only if it gains:
     - docs index;
     - runtime health;
     - usage accounting;
     - quality gates;
     - clear Discord integration strategy;
     - explicit user value beyond experimentation.

## Verification Plan

- Focused:
  - `pnpm vitest run src/stage`
  - Add boundary static test if implemented.
- Static:
  - `pnpm run typecheck`
  - `pnpm run lint`
- Docs:
  - `pnpm run quality:docs` if adding a feature doc or index entry.
- Full:
  - `pnpm test`

## Risks And Rollback

- Risk: boundary doc becomes stale while code drifts.
  - Mitigation: add a static import-boundary test when practical.
- Risk: Stage refactor blocks core bot work.
  - Mitigation: keep Stage adaptation to runtime contracts as a follow-up, not a prerequisite.
- Risk: docs make Stage look unsupported rather than experimental.
  - Mitigation: state current usable commands and exact scope.
- Risk: future multi-agent ideas leak into default task path.
  - Mitigation: keep default Discord task single-agent unless a dedicated plan changes it.

## Documentation Sync

- Add or update Stage doc.
- Update `docs/README.md` if a new doc is added.
- Update `docs/architecture.md` only if shared runtime contracts become part of Stage.
- Run `pnpm run quality:docs`.

## Execution Notes

Record doc path, boundary tests, and any runtime-contract adoption status here when implemented.

