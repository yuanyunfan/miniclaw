# Futu Stock Cron Pre-Provider

Status: completed
Date: 2026-05-07

## Background

The user wants the existing `daily-stock-market` Discord cron reports to include their Futu account holdings and daily P&L. MiniClaw already has a read-only `src/mcp/futu-stock` MCP server that can query local OpenD through the official Futu Python SDK, map broker data into a snapshot, and redact sensitive output.

The current stock cron jobs are pure LLM prompts. They do not pass account context into the task, so the report cannot explain portfolio exposure, position-level contribution, or whether the market analysis matters to the user's actual holdings.

## Goals

- Add a built-in `futu-stock` cron `pre_provider`.
- Reuse the existing read-only Futu client, mapper, and redaction code.
- Output compact, redacted JSON suitable for prepending to a cron task prompt.
- Configure the existing premarket and postmarket stock cron jobs to use the provider.
- Keep all account configuration in `~/.miniclaw/providers/futu-stock`, outside git.
- Keep the integration read-only: no trade unlock, no order, no trade password, no raw account identifiers.
- Add focused tests for provider config parsing, formatting/redaction, and provider execution with an injected fake client.

## Non-Goals

- Do not implement trading, order management, strategy execution, or cash transfer.
- Do not expose raw Futu account rows, full account IDs, tokens, cookies, phone numbers, or trade passwords.
- Do not require the LLM to call the MCP tool directly during cron execution.
- Do not solve multi-broker aggregation in this slice.
- Do not commit user-level `~/.miniclaw` cron/provider YAML files.

## Existing Architecture Evidence

- `src/providers/types.ts`: defines `PreProviderRunArgs` and `PreProviderResult`.
- `src/providers/index.ts`: central registry for allowed pre-providers.
- `src/cron/runner-task.ts`: runs `pre_provider` before task execution and prepends its output via a prompt template.
- `src/mcp/futu-stock/futu-client.ts`: read-only Python bridge through local OpenD.
- `src/mcp/futu-stock/mapper.ts`: converts raw Futu data into `FutuAccountSnapshot`.
- `src/mcp/futu-stock/redact.ts`: formats and redacts Discord/LLM-safe output.
- `~/.miniclaw/cron/stock-market-premarket.yaml`: existing premarket stock report cron.
- `~/.miniclaw/cron/a-share-hk-postmarket.yaml`: existing A/HK postmarket stock report cron.

## Implementation Plan

1. Add `src/providers/futu-stock`:
   - provider config loader from `~/.miniclaw/providers/futu-stock/<name>.yaml`;
   - provider-level types;
   - formatter that emits compact JSON with redacted snapshot, report text, top positions, and warnings;
   - `runFutuStockProvider`, with optional dependency injection for tests.
2. Register `futu-stock` in `src/providers/index.ts` so cron loader accepts it.
3. Add tests:
   - config loader parses defaults and rejects unsafe config names;
   - formatter does not expose exact total assets in summary mode and redacts account-like strings;
   - provider can run with a fake client and returns parseable redacted JSON.
4. Add local user config:
   - `~/.miniclaw/providers/futu-stock/daily-stock-market.yaml`.
5. Update local cron jobs:
   - add `pre_provider: futu-stock`;
   - add `pre_provider_config: daily-stock-market`;
   - align schedules to Beijing `09:15` and `15:15`;
   - adjust prompts to explicitly use the prepended redacted Futu JSON for portfolio-aware analysis.
6. Update `docs/archive/features/06-futu-stock.md`, `docs/architecture.md`, and README project structure as needed.

## Verification Plan

- Type check: `pnpm build`.
- Focused tests: `pnpm vitest run src/providers/futu-stock src/mcp/futu-stock`.
- Full tests: `pnpm test`.
- Cron config check: `pnpm cron:list`.
- Live smoke, without printing sensitive values:
  - run `runFutuStockProvider` against local OpenD;
  - print only alias/session/positions count/warning count.
- Restart MiniClaw after user-level cron changes so the scheduler reloads config.

## Risks And Rollback

- Risk: OpenD is not running or Futu session expires.
  - Mitigation: provider fails with a short sanitized error; cron reports `pre_provider` failure rather than fabricating account data.
- Risk: provider output leaks account identifiers or exact asset totals.
  - Mitigation: reuse `redactedSnapshotJson`, `formatFutuDailyPnlReport`, `redactSensitiveText`, and add provider tests.
- Risk: prompt overweights snapshot P&L as final settlement.
- Media: output and prompts include P&L warnings.
- Rollback: remove `futu-stock` from provider registry and remove `pre_provider` lines from the two user cron YAML files.

## Documentation Sync

- Update `docs/archive/features/06-futu-stock.md` with the implemented pre-provider and cron wiring.
- Update `docs/architecture.md` provider examples.
- Update README project structure if a new provider directory is introduced.

## Execution Notes

- Added `src/providers/futu-stock` with provider config loading, per-job `market_session`, compact JSON formatting, and dependency-injected execution tests.
- Registered `futu-stock` in the pre-provider registry.
- Fixed the shared Futu redaction helper so long fractional percentages are not mistaken for account-like whole numbers.
- Added local provider config at `~/.miniclaw/providers/futu-stock/daily-stock-market.yaml`.
- Updated local cron jobs `stock-market-premarket` and `a-share-hk-postmarket` to use `pre_provider: futu-stock` and schedules `15 9 * * 1-5` / `15 15 * * 1-5`.
- Verification passed:
  - `pnpm build`
  - `pnpm vitest run src/providers/futu-stock src/mcp/futu-stock`
  - `pnpm test`
  - `pnpm cron:list`
  - live provider smoke against local OpenD, printing only alias/session/position counts.
