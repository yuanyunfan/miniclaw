# Config Schema-First Refactor

Status: draft
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

