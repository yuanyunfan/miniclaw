# Stock Provider Data-Layer Migration

Status: completed (compatibility migration)
Date: 2026-05-17

## Background

MiniClaw stock providers currently work as cron pre-provider context builders. That is useful for delivery, but the implementation boundary is overloaded: source access, normalized stock data, signal calculation, report composition, and cron compatibility are often mixed inside the same provider folder.

The stock domain has a stronger long-term axis than individual cron tasks. Portfolio snapshots, quotes, watchlists, market calendars, macro evidence, ETF premium data, and market memory should be stable data capabilities. Cron tasks should compose those capabilities into a report instead of owning the underlying data model.

## Goals

- Migrate stock internals to a four-layer design: Source Adapter, Data Domain, Signal / Intelligence, and Report Composer / Cron Provider.
- Keep all existing stock cron provider names and cron YAML fields compatible during the migration.
- Move reusable stock logic into `src/stock/*` without a big-bang rewrite.
- Make market memory a first-class stock data capability that can be injected into every relevant stock task.
- Preserve provider redaction, readonly safety, health check, dry-run, `skipTask`, and commit-after-success behavior.

## Non-Goals

- Do not rename existing provider registry names in this plan.
- Do not change cron schema fields such as `pre_provider`, `pre_provider_config`, `pre_context_providers`, or `pre_provider_preflight`.
- Do not add new external stock data vendors in the first migration.
- Do not move account credentials, session material, cookies, or private brokerage details into repo docs or repo code.
- Do not make LLM prompts responsible for deterministic source mapping or signal computation.

## Existing Architecture Evidence

- Relevant provider files:
  - `src/providers/index.ts`: registers `futu-stock`, `eastmoney-jywg-readonly`, `eastmoney-etf-premium`, `stock-portfolio`, `stock-pulse`, `market-intel`, `market-forecast-evaluation`, `market-context`, and `stock-watchlist-research`.
  - `src/providers/framework.ts`: defines `ProviderModule`, health checks, dry runs, structured `run()`, `format()`, and optional `commit()`.
  - `src/cron/types.ts`: defines `pre_provider`, `pre_context_providers`, and provider preflight options.
  - `src/providers/stock-pulse/*`: currently mixes universe collection, quote fetching, market-window checks, alert generation, and report payload formatting.
  - `src/providers/market-intel/*`: currently mixes portfolio context, quote snapshots, official evidence collection, scoring, and report formatting.
  - `src/providers/market-context/*` and `src/store/market-context.ts`: implement rolling market memory and forecast injection.
- Relevant source files:
  - `src/mcp/futu-stock/*`: Futu OpenD readonly account and watchlist access.
  - `src/mcp/eastmoney-jywg/*`: Eastmoney JYWG readonly account access.
  - `src/mcp/eastmoney-myfavor/*`: Eastmoney MyFavor watchlist access.
  - `src/providers/eastmoney-etf-premium/*`: public ETF premium data.
- Relevant docs:
  - `docs/providers/provider-framework.md`
  - `docs/providers/stock/README.md`
  - `docs/providers/stock/eastmoney.md`
  - `docs/providers/stock/research.md`

## Target Four-Layer Architecture

The target internal layout is:

```text
src/stock/
  sources/
  data/
  signals/
  reports/
  types.ts
```

Layer responsibilities:

- Source Adapter:
  - Owns external connection details, authentication boundaries, raw payload validation, minimal normalization, source-specific retries, and redaction.
  - Candidate modules: `sources/futu`, `sources/eastmoney`, `sources/yahoo`, and `sources/official`.
  - Must not decide report wording, investment interpretation, or cron skip policy.

- Data Domain:
  - Owns stable stock semantics such as portfolio, quotes, universe, market calendar, ETF premium, market evidence, and market memory.
  - Exposes reusable interfaces independent of a specific cron task.
  - Converts source adapter output into durable domain snapshots.

- Signal / Intelligence:
  - Turns domain snapshots into explainable signals with rationale, severity, evidence references, and confidence where available.
  - Candidate modules: `signals/pulse`, `signals/portfolio-risk`, `signals/market-intel`, `signals/forecast-evaluation`, and `signals/context-synthesis`.
  - Must output structured facts, not final prompt prose.

- Report Composer / Cron Provider:
  - Keeps the existing cron-facing provider names as compatibility wrappers.
  - Loads provider config, creates provider context, composes Data Domain and Signal output, injects market memory, formats LLM context, and preserves `commit()` semantics.
  - Candidate modules: `reports/stock-portfolio`, `reports/stock-pulse`, `reports/market-intel`, `reports/market-context`, `reports/forecast-evaluation`, and `reports/watchlist-research`.

## Implementation Plan

1. Freeze the docs and compatibility boundary.
   - Keep existing provider names and cron YAML fields stable.
   - Document that `src/providers/*` is the cron-facing compatibility layer, while `src/stock/*` becomes the reusable stock domain layer.

2. Introduce shared stock types.
   - Add `src/stock/types.ts` with market scope, symbol, quote snapshot, portfolio snapshot, market evidence, market memory, and stock signal types.
   - Keep these types vendor-neutral and cron-neutral.

3. Extract Source Adapters.
   - Move or re-export Futu access through `src/stock/sources/futu`.
   - Move or re-export Eastmoney JYWG, MyFavor, and ETF premium access through `src/stock/sources/eastmoney`.
   - Move Yahoo quote access from `stock-pulse` and `market-intel` into `src/stock/sources/yahoo`.
   - Move official evidence collectors from `market-intel` into `src/stock/sources/official`.
   - Preserve existing tests and public provider behavior in the first pass.

4. Extract Data Domain modules.
   - `data/portfolio`: unified account, position, allocation, and PnL snapshots.
   - `data/quotes`: quote and intraday bar snapshots.
   - `data/universe`: configured symbols, portfolio symbols, watchlist symbols, and source symbols.
   - `data/calendar`: market open/closed windows, trade dates, sessions, and time zones.
   - `data/etf-premium`: premium and discount data for ETF-related analysis.
   - `data/market-evidence`: macro, news, earnings, filing, policy, calendar, and risk evidence.
   - `data/market-memory`: read and write access to daily market summaries, active items, and forecast history.

5. Extract Signal / Intelligence modules.
   - Move stock pulse anomaly logic from `stock-pulse/analyzer.ts` into `signals/pulse`.
   - Move market-intel scoring and calibration into `signals/market-intel`.
   - Move forecast evaluation and calibration into `signals/forecast-evaluation`.
   - Add `signals/context-synthesis` for yesterday memory plus today's evidence into today's market memory.
   - Keep outputs deterministic and testable.

6. Thin the cron-facing providers.
   - Convert each stock provider under `src/providers/*` into config loading, composer invocation, formatting, and commit wrapping.
   - Keep `ProviderModule` support for health checks and dry runs where it already exists.
   - Gradually migrate legacy-only stock providers to `ProviderModule` once their composer output is structured.

7. Reorganize stock docs after code migration starts.
   - Keep `docs/providers/stock/README.md` as the family entry.
   - Add source-family docs only after the source adapters exist in code.
   - Add pipeline docs only after report composers exist in code.
   - Do not document planned module paths as completed implementation facts before the code exists.

## Verification Plan

- Source Adapter tests:
  - Futu, Eastmoney, Yahoo, and official collector fixtures still map to the same safe payloads.
  - Redaction, readonly safety, auth failures, and format drift remain covered.
- Data Domain tests:
  - Portfolio snapshots, quote snapshots, universe merging, market calendar decisions, ETF premium snapshots, market evidence, and market memory queries are deterministic.
- Signal tests:
  - Stock pulse alerts match existing fixture behavior.
  - Market-intel scoring and calibration match existing expectations.
  - Forecast evaluation preserves previous hit-rate and calibration behavior.
  - Context synthesis is deterministic for the same previous memory and evidence input.
- Composer tests:
  - Existing stock provider outputs remain schema-compatible.
  - `skipTask`, `commit`, dry-run, and health-check behavior remain intact.
  - Market context can still be injected through `pre_context_providers`.
- Suggested gates per slice:
  - `pnpm vitest run src/mcp/futu-stock src/mcp/eastmoney-jywg src/mcp/eastmoney-myfavor`
  - `pnpm vitest run src/providers/stock-portfolio src/providers/stock-pulse src/providers/market-intel src/providers/market-context src/providers/market-forecast-evaluation src/providers/stock-watchlist-research`
  - `pnpm run typecheck`
  - `pnpm run quality:docs`

## Risks And Rollback

- Risk: moving logic changes provider output shape.
  - Mitigation: keep fixture-based compatibility tests around every migrated provider.
  - Rollback: restore the provider wrapper to call the previous implementation while keeping extracted modules unused.

- Risk: source adapters accidentally expose account or session details.
  - Mitigation: keep redaction and readonly safety tests at the source boundary.
  - Rollback: revert the source extraction slice and keep existing MCP/provider boundary.

- Risk: cron tasks become coupled to the new domain API before it is stable.
  - Mitigation: expose report composers through existing provider wrappers first.
  - Rollback: leave cron config unchanged and switch wrappers back to legacy code.

- Risk: docs describe future implementation as current fact.
  - Mitigation: keep this document under `docs/plans/` until code migration is complete.
  - Rollback: mark this plan superseded and update provider docs only with verified implementation facts.

## Documentation Sync

- `docs/providers/stock/README.md`: link to this plan as the target architecture migration, without replacing current provider facts.
- `docs/providers/provider-framework.md`: update only if provider framework contracts change.
- `docs/documentation-migration-map.md`: track this plan and its Chinese mirror.
- Website pages: no public copy change is required for this plan unless provider capability summaries change.
- Changelog: not required for this docs-only plan unless the code migration ships user-visible behavior.

## Execution Notes

- 2026-05-17: Plan created from current provider code inspection and previous stock provider architecture discussion.
- 2026-05-17: Implemented the compatibility migration slice. `src/providers/*/index.ts` remains the cron-facing compatibility layer for all stock provider names, while reusable stock implementation now lives under `src/stock/`.
- 2026-05-17: Added `src/stock/types.ts`, source adapter modules for Futu, Eastmoney, Yahoo, and official evidence, data-domain bridge modules for calendar, universe, quotes, portfolio, ETF premium, market evidence, and market memory, signal modules for pulse, market-intel scoring, forecast evaluation, and context synthesis, plus report composers for every existing stock cron provider.
- 2026-05-17: Verified compatibility with `pnpm run typecheck`, stock provider focused Vitest coverage, and Futu/Eastmoney MCP focused Vitest coverage.
