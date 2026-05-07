# Layered YAML Configuration

Status: completed
Date: 2026-05-07

## Background

MiniClaw currently reads most runtime settings from flat `.env` variables in `src/config.ts`. This works for secrets, but it makes the growing `MINICLAW_*` settings hard to scan because parent-child relationships such as Discord routing, agent defaults, Codex sandboxing, Claude settings, MCP, storage, and attachments are only encoded in long variable names.

The preferred direction is to keep `.env` for secrets and process bootstrap values, then move structured MiniClaw settings into a user-level YAML file.

## Goals

- Add `~/.miniclaw/config.yaml` support with `MINICLAW_CONFIG` as an optional override path.
- Use precedence: built-in defaults < YAML config < env overrides.
- Preserve backward compatibility for existing `MINICLAW_*` env names.
- Keep secrets out of tracked files and out of normal command output.
- Centralize MCP config path and allowlist through the main config object.
- Expose safe config file metadata in `/agent-config`.
- Update docs and examples so the recommended setup is visually hierarchical.

## Non-Goals

- Do not migrate every advanced env-only extension point in one pass, such as prompt dirs, memory path, cron dirs, stage caps, or log formatting.
- Do not put API keys or Discord bot tokens into the YAML example.
- Do not change cron job config formats or provider-specific YAML files.
- Do not alter provider behavior beyond configuration loading.

## Existing Architecture Evidence

- Relevant files:
  - `src/config.ts`: env-only MiniClaw runtime config.
  - `src/agent/mcp.ts`: still reads `MINICLAW_MCP_CONFIG` and `MINICLAW_MCP_ALLOWLIST` directly.
  - `src/agent/runtime-config.ts`: powers `/agent-config` safe runtime summary.
  - `.env.example`, `README.md`, `README.en.md`, `docs/architecture.md`: document env-based setup.
- Relevant commands:
  - `pnpm build`
  - `pnpm test src/__tests__/config.test.ts src/agent/__tests__/mcp.test.ts src/agent/__tests__/codex.test.ts src/agent/__tests__/runtime-config.test.ts`
  - `pnpm test`
- Relevant data/config:
  - Local `.env` contains secrets and flat MiniClaw settings.
  - User-level config should live under `~/.miniclaw/` and stay out of git.

## Implementation Plan

1. Add a YAML loader in `src/config.ts`.
2. Introduce typed parsing helpers for string, enum, inherit, boolean, positive number, unlimited number, and string arrays.
3. Map YAML sections to existing exported config shape:
   - `discord`
   - `routing`
   - `agent`
   - `claude`
   - `codex`
   - `mcp`
   - `storage`
   - `attachments`
4. Keep all legacy env keys as overrides.
5. Update `src/agent/mcp.ts` to consume `config.mcp`.
6. Add focused unit tests for YAML loading and env override precedence.
7. Update runtime config output to show safe config metadata.
8. Add `config.example.yaml` and rewrite setup docs around YAML-first configuration.
9. Migrate the local machine config by writing `~/.miniclaw/config.yaml` from non-secret `.env` values and reducing local `.env` to secrets/bootstrap values.

## Verification Plan

- Type check: `pnpm build`.
- Unit tests:
  - Config YAML loading and env override precedence.
  - MCP loader still honors env overrides through centralized config.
  - Codex inherit behavior remains unchanged.
  - `/agent-config` formatting remains secret-safe.
- Integration check:
  - Restart pm2 with updated env.
  - Inspect recent pm2 logs for startup errors.

## Risks And Rollback

- Risk: Existing `.env` values with empty strings may unintentionally override YAML.
  - Mitigation: Treat blank env values as unset; use `none` when an explicit empty array override is needed.
- Risk: Importing config from `mcp.ts` can affect test isolation.
  - Mitigation: Update MCP tests to set env before dynamic import.
- Risk: Local `.env` migration could drop an unknown setting.
  - Mitigation: Preserve unknown env keys and only move known non-secret settings.
- Rollback: Remove `MINICLAW_CONFIG` from `.env` and restore previous flat `MINICLAW_*` values; code keeps legacy env support.

## Documentation Sync

- README: YAML-first quick start and env override compatibility.
- README.en: English equivalent.
- docs: architecture and planning notes.
- CHANGELOG: record layered config support.

## Execution Notes

- Implemented `src/config.ts` as a layered loader with built-in defaults, YAML config, and legacy env overrides.
- Centralized Claude-provider MCP path and allowlist through `config.mcp`.
- Added `config.example.yaml` and rewrote `.env.example` so `.env` is secrets/bootstrap first.
- Updated `/agent-config` summary with safe config file metadata.
- Migrated local machine config to `~/.miniclaw/config.yaml`; local `.env` now contains only `MINICLAW_CONFIG`, Discord token, Anthropic key, and Anthropic base URL. Original `.env` was backed up under `~/.miniclaw/backups/`.
- Preserved legacy blank `MINICLAW_DEFAULT_BUDGET_USD` / `MINICLAW_DEFAULT_MAX_TURNS` behavior as `unlimited`.
- Verification:
  - `pnpm build` passed.
  - Focused tests passed: `src/__tests__/config.test.ts`, `src/agent/__tests__/mcp.test.ts`, `src/agent/__tests__/codex.test.ts`, `src/agent/__tests__/runtime-config.test.ts`.
  - Full `pnpm test` passed: 36 test files, 257 tests.
  - PM2 restarted with `--update-env`; logs show `provider=codex model=inherit budget=unlimited maxTurns=unlimited maxConcurrent=4` and cron scheduler started with 16 active jobs / 0 load errors.
