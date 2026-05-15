# Config Schema-First Refactor

Status: done
Date: 2026-05-11

## Background

`src/config.ts` currently handles YAML/env loading, type coercion, validation, path resolution, E2E isolation guard, agent runtime config, doctor/connectivity config, Smart Router config, attachment/audio transcription config, and more.

The project already depends on `zod`, but the main config path is not yet schema-first. New runtime, provider, transport, doctor, retention, and task trace settings will continue raising review cost if every field is appended to one large config file.

## Goals

- Split config into load, schema, resolve, and runtime layers.
- Preserve `import { config } from "../config.js"` during migration.
- Make new config fields require schema, defaults, env key mapping, and tests.
- Isolate E2E guard tests from full config import side effects.
- Make provider/doctor/runtime config reviewable by smaller files.

## Non-Goals

- Do not break existing user `~/.miniclaw/config.yaml`.
- Do not require a new config file format in the first slice.
- Do not remove env overrides that currently work.
- Do not migrate secrets or runtime state.
- Do not combine this with broad runtime contract changes unless the contract types already exist.

## Existing Architecture Evidence

- `src/config.ts`: current all-in-one config module.
- `src/__tests__/config.test.ts`: existing config parsing/default/override tests.
- `config.example.yaml`: user-facing example config.
- `src/e2e/__tests__/safety.test.ts`: E2E isolation guard coverage.
- `src/agent/runtime-config.ts`: formats runtime config summary.
- `docs/architecture.md`: documents config and user-level file layout.

## Target Layout

```text
src/config/
  index.ts          # exports config and public types
  load.ts           # file/env/source loading only
  schema.ts         # zod schemas and raw parsed types
  env.ts            # env key mapping and parsing helpers
  resolve.ts        # home path, defaults, inherit, cwd resolution
  runtime.ts        # final readonly runtime config object
  e2e-guard.ts      # E2E isolation validation
  types.ts          # public config types if needed
```

Keep `src/config.ts` temporarily as a facade:

```ts
export * from "./config/index.js";
```

Only remove the facade after imports are migrated and tested.

## Layer Responsibilities

### `load.ts`

- Determine config file path.
- Read YAML if present.
- Return raw object plus metadata.
- Do not resolve paths.
- Do not validate business rules beyond parse failure.

### `schema.ts`

- Define Zod schemas and defaults.
- Validate shape and allowed enum values.
- Keep raw config types close to schemas.
- Do not read files or env directly.

### `env.ts`

- Map `MINICLAW_*` env vars to config patch values.
- Parse booleans, numbers, arrays, and paths consistently.
- Include tests per env key.

### `resolve.ts`

- Resolve `~`, relative paths, default cwd, channel defaults, and inherited agent settings.
- Keep pure where possible.

### `runtime.ts`

- Compose load + env + schema + resolve.
- Export final frozen/readonly config.
- Run final cross-field validation.

### `e2e-guard.ts`

- Validate E2E temp-dir isolation.
- Test without importing the entire running config singleton when possible.

## Implementation Plan

1. Inventory current config fields.
   - Group by domain:
     - Discord/core
     - agent/Claude/Codex
     - routing/Smart Router
     - storage/memory
     - cron
     - doctor/connectivity
     - attachments/audio
     - E2E
     - providers
2. Add `src/config/` modules without behavior changes.
   - Move pure helpers first.
   - Keep public exports stable through `src/config.ts`.
3. Introduce Zod schemas incrementally.
   - Start with one domain such as `doctor` or `smart_router`.
   - Preserve existing defaults from tests.
   - Add tests that prove invalid config fails with useful messages.
4. Move env parsing to `env.ts`.
   - Build a table of env keys and target paths.
   - Add tests for current high-value env overrides.
5. Move path resolution to `resolve.ts`.
   - Include `~` expansion, default cwd, DB path, memory path, repair worktree root, and channel defaults.
6. Move E2E guard to `e2e-guard.ts`.
   - Add tests for allowed temp paths and blocked real user paths.
7. Freeze the runtime config object.
   - Prevent accidental mutation during runtime.
   - If tests mutate config today, refactor tests to reload modules with env/config changes.
8. Update imports only when needed.
   - Keep most call sites importing from `../config.js`.
   - Internal config tests can import specific modules.
9. Update config docs and examples.

## Verification Plan

- Focused:
  - `pnpm vitest run src/__tests__/config.test.ts src/e2e/__tests__/safety.test.ts`
  - Add tests for `src/config/*.test.ts` if colocated under `src/config/__tests__/`.
- Static:
  - `pnpm run typecheck`
  - `pnpm run lint`
- Regression:
  - `pnpm test`
  - `pnpm run build`
- Config smoke:
  - Load default config with no config file in a temp env.
  - Load `config.example.yaml` if a helper exists or add one.

## Risks And Rollback

- Risk: import path breaks because `src/config.ts` and `src/config/` collide.
  - Mitigation: keep `src/config.ts` facade and use explicit relative imports.
- Risk: defaults change silently.
  - Mitigation: current config tests must pass unchanged before adding new semantics.
- Risk: env override precedence changes.
  - Mitigation: add tests for precedence: defaults < YAML < env.
- Risk: E2E guard becomes weaker.
  - Mitigation: preserve existing safety tests and add direct unit tests for guard function.

## Documentation Sync

- Update `docs/architecture.md` config section.
- Update `config.example.yaml` only when user-facing shape changes.
- Update `docs/quality-gates.md` if config validation becomes part of a quality gate.
- Run `pnpm run quality:docs`.

## Execution Notes

Record moved modules, compatibility behavior, env precedence, and verification commands here when implemented.

### 2026-05-12 - Config Load/Env/Resolve/E2E Boundary Extraction

- Scope: first schema-first refactor phase. Split pure config loading, env/type coercion, path resolution, raw schema/enums, E2E guard, and public config types out of the all-in-one runtime module while preserving the existing `src/config.ts` import facade and user-facing config shape.
- Changed files:
  - `src/config.ts`: reduced to compatibility facade re-exporting `src/config/index.ts`.
  - `src/config/index.ts`: kept runtime config assembly, `config`, `assertE2eSafeRuntimePath()`, public type re-exports, process env base URL side effects, and existing default/env precedence behavior.
  - `src/config/load.ts`: extracted `MINICLAW_CONFIG` path resolution, YAML loading, missing explicit config handling, and raw object schema handoff.
  - `src/config/env.ts`: extracted raw config reader, env precedence, scalar coercion, enum/inherit parsing, boolean/number/list parsing, and unlimited budget/turn semantics.
  - `src/config/schema.ts`: added Zod-backed raw object validation plus shared enum value constants.
  - `src/config/resolve.ts`: extracted home path and channel default cwd resolution.
  - `src/config/e2e-guard.ts`: extracted pure E2E temp-dir isolation checks so guard behavior can be tested without importing the runtime singleton.
  - `src/config/types.ts`: moved public config type aliases and notification config interface.
  - `src/config/__tests__/config-boundaries.test.ts`: added boundary tests for YAML loading, explicit missing config behavior, raw schema rejection, env precedence, blank-env unlimited semantics, path resolution, and E2E guard behavior.
  - `src/quality/docs-drift.ts`, `src/quality/__tests__/docs-drift.test.ts`, `docs/quality-gates.md`: updated docs drift mapping so future `src/config/**` changes require config docs sync.
  - `docs/architecture.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: documented the new config facade/module boundary and remaining runtime assembly hotspot.
- Behavior parity tests:
  - `pnpm vitest run src/quality/__tests__/docs-drift.test.ts src/config/__tests__/config-boundaries.test.ts src/__tests__/config.test.ts src/e2e/__tests__/safety.test.ts` passed, 36 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run quality:docs` passed.
  - `pnpm run build` passed; generated ignored `dist/` artifacts were removed after verification.
- Public API changes: none. Existing imports from `src/config.ts` / `../config.js` remain valid, and no user-facing YAML/env key shape changed.
- Follow-up cleanup: split `src/config/index.ts` by domain runtime builders, add deeper domain Zod schemas/default/env mapping tests, and freeze the final runtime config object when test mutation patterns have been removed.

### 2026-05-12 - Config Runtime Domain Builder Extraction

- Scope: completed the schema-first config boundary. Split final runtime composition out of `src/config/index.ts`, added domain runtime builders for agent/Codex/Claude, routing/Smart Router, storage/state, tasks trace attach, doctor/connectivity/notifications, attachments/audio transcription, provider endpoints, E2E, and MCP, and runtime-froze the final config object without changing public TypeScript config shapes.
- Changed files:
  - `src/config/index.ts`: reduced to public exports and the existing proxy side-effect import.
  - `src/config/runtime.ts`: added `createRuntimeConfig()`, `config`, `assertE2eSafeRuntimePath()`, deep runtime freeze, provider base URL env side-effect preservation, auto-reply warning, and final E2E cross-field validation.
  - `src/config/domains/*.ts`: added domain builders that keep defaults, YAML paths, env keys, enum/typed validators, and path resolution near each config domain.
  - `src/config/__tests__/config-boundaries.test.ts`: added direct runtime composition and deep-freeze coverage without importing the singleton config facade.
  - `docs/architecture.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: updated config boundary documentation and current hotspot status.
- Behavior parity tests:
  - `pnpm vitest run src/config/__tests__/config-boundaries.test.ts src/__tests__/config.test.ts src/e2e/__tests__/safety.test.ts` passed, 28 tests.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - `pnpm run quality:docs` passed with schema v10.
  - `pnpm run build` passed; generated ignored `dist/` artifacts were removed after verification.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard` passed: `pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- Public API changes: none. Existing `import { config } from "../config.js"` call sites remain valid; runtime freeze is enforced at runtime, but the public TypeScript shape was kept compatible to avoid widening this refactor into call-site type migration.
- Follow-up cleanup: Config plan is complete. New config fields should land in the matching domain builder plus focused config tests, not in `src/config/index.ts`.
