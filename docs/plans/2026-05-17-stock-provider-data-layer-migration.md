# Stock Provider Data-Layer Migration

Status: in progress (compatibility + source/data cleanup completed; ownership cleanup pending)
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

## Remaining Execution Plan

The compatibility migration already moved the main runtime entrypoints into `src/stock/reports/*`, but the migration is not complete until stock domain code no longer depends on stock-specific files under `src/providers/*`. The next execution plan is therefore an ownership cleanup, not another broad directory shuffle.

### Completion Definition

The migration is complete only when all of these are true:

- `src/stock/sources/*`, `src/stock/data/*`, and `src/stock/signals/*` do not import stock-specific modules from `src/providers/*`.
- `src/stock/reports/*` may import the generic provider framework contracts, but stock-specific config/type/format ownership either lives in `src/stock/*` or is passed in from a thin provider wrapper.
- Each stock provider folder under `src/providers/*` contains only compatibility exports, config loading, provider framework adapters, tests for compatibility behavior, and small provider-specific cron glue.
- Existing cron YAML provider names and config file locations remain compatible.
- Fixture output shape is unchanged unless a planned schema version bump is explicitly documented.

### Slice 0: Baseline And Dependency Guard

Goal: make the remaining work measurable before moving code.

Actions:

- Record the current stock provider compatibility list from `src/providers/index.ts`.
- Record the current reverse dependency count with `rg "../../providers|../../../providers|../../../../providers|../../../../../providers" src/stock --glob '*.ts'`.
- Add or document a guard expectation that `src/stock/sources`, `src/stock/data`, and `src/stock/signals` must not import stock-specific provider modules.
- Keep `src/stock/reports` temporarily exempt because it is still the cron-facing composer layer.

Acceptance criteria:

- A reviewer can tell exactly which remaining imports are allowed and which are migration debt.
- The baseline command is included in the final PR or commit summary for the cleanup slice.

Verification:

- `pnpm run typecheck`
- `pnpm run quality:docs`

Rollback:

- Documentation-only slice; revert the docs addition if the guard wording proves too strict.

### Slice 1: Move Stock Domain Types Out Of Providers

Goal: remove the largest coupling source: stock data and signal types currently owned by provider folders.

Target moves:

- `src/providers/stock-pulse/types.ts` -> stock-owned pulse/universe/quote types.
- `src/providers/market-intel/types.ts` -> stock-owned market evidence, market snapshot, scoring, and payload types.
- `src/providers/stock-portfolio/types.ts` -> stock-owned portfolio aggregation and premium types.
- `src/providers/market-forecast-evaluation/types.ts` -> stock-owned forecast evaluation types.
- `src/providers/market-context/types.ts` -> stock-owned market memory/report context types.
- `src/providers/futu-stock/types.ts`, `src/providers/eastmoney-jywg-readonly/types.ts`, and `src/providers/eastmoney-etf-premium/types.ts` -> source/report payload types under the relevant `src/stock/sources/*`, `src/stock/data/*`, or `src/stock/reports/*` module.

Implementation approach:

- Prefer module-local stock type files when a single flat `src/stock/types.ts` would become too broad. For example, `src/stock/data/portfolio-types.ts`, `src/stock/data/market-intel-types.ts`, and `src/stock/signals/forecast-evaluation-types.ts` are acceptable.
- Keep `src/providers/*/types.ts` as compatibility re-export files for one migration cycle.
- Update all non-provider imports first, then update provider tests.
- Do not change runtime payload schema in this slice.

Acceptance criteria:

- `src/stock/sources/*`, `src/stock/data/*`, and `src/stock/signals/*` no longer import provider `types.ts`.
- Provider `types.ts` files either disappear or become pure re-export compatibility facades.
- No cron config or runtime provider name changes.

Verification:

- `pnpm vitest run src/providers/stock-portfolio src/providers/stock-pulse src/providers/market-intel src/providers/market-context src/providers/market-forecast-evaluation src/providers/stock-watchlist-research`
- `pnpm vitest run src/mcp/futu-stock src/mcp/eastmoney-jywg src/mcp/eastmoney-myfavor`
- `pnpm run typecheck`

Rollback:

- Revert the type move while keeping the previous provider-owned type files intact.

### Slice 2: Move Portfolio Data Semantics Into Data Domain

Goal: make `src/stock/data/portfolio.ts` a real data-domain module instead of a re-export of provider formatting.

Target moves:

- Move portfolio payload construction, CNY rollup, FX conversion, source compaction, source error redaction, and position premium merge logic from `src/providers/stock-portfolio/format.ts` into `src/stock/data/portfolio.ts` or smaller `src/stock/data/portfolio-*` modules.
- Move the data part of asset classification guidance into `src/stock/data/portfolio.ts` or a dedicated portfolio classification module.
- Keep final JSON string formatting either in `src/stock/reports/stock-portfolio.ts` or as a data-domain serializer with a clear name.

Provider boundary after slice:

- `src/providers/stock-portfolio/format.ts` should either be removed or reduced to a compatibility re-export.
- `src/stock/reports/stock-portfolio.ts` should import portfolio domain functions from `src/stock/data/portfolio*`, not from provider format files.

Acceptance criteria:

- `src/stock/data/portfolio.ts` no longer imports `../../providers/stock-portfolio/format.js`.
- Portfolio tests still prove `position_premium_summary`, CNY rollup, source error handling, and redacted source payload behavior.
- Existing daily stock summary and A/H stock cron payloads remain schema-compatible.

Verification:

- `pnpm vitest run src/providers/stock-portfolio src/providers/futu-stock src/providers/eastmoney-jywg-readonly src/providers/eastmoney-etf-premium`
- `pnpm run typecheck`

Rollback:

- Restore the provider format module as the implementation source and leave the stock data module as a facade.

### Slice 3: Move Portfolio Visualization And Classification Signals

Goal: remove non-provider chart and classification logic from `src/providers/stock-portfolio`.

Target moves:

- Move `src/providers/stock-portfolio/pie-chart.ts` into `src/stock/reports/portfolio-pie-chart.ts` if treated as report rendering, or `src/stock/signals/portfolio-allocation.ts` plus a report renderer if classification is reused.
- Keep PNG file output under runtime storage unchanged.
- Keep chart attachment behavior in `runStockPortfolioProvider`.

Acceptance criteria:

- No stock report imports `../../providers/stock-portfolio/pie-chart.js`.
- Pie chart model tests still cover domestic equity, overseas equity, bond buckets, gold, cash, unclassified assets, label ordering, and rendering.
- Runtime attachment metadata remains unchanged.

Verification:

- `pnpm vitest run src/providers/stock-portfolio/__tests__/pie-chart.test.ts src/providers/stock-portfolio/__tests__/index.test.ts`
- `pnpm run typecheck`

Rollback:

- Re-export the moved chart module from the old provider path for one migration cycle.

### Slice 4: Move Market Intel Formatting And Calibration Ownership

Goal: put market-intel payload assembly, data quality assembly, and calibration logic under stock-owned data/signal/report modules.

Target moves:

- Move `src/providers/market-intel/format.ts` payload builders into `src/stock/reports/market-intel-format.ts` or split reusable data quality logic into `src/stock/data/market-evidence.ts`.
- Move `src/providers/market-intel/calibration.ts` into `src/stock/signals/market-intel-calibration.ts`.
- Update `src/stock/signals/market-intel.ts`, `src/stock/reports/market-intel.ts`, and `src/stock/reports/watchlist-research.ts` to import calibration and payload builders from stock-owned modules.
- Keep provider config loading in `src/providers/market-intel/config.ts` unless and until provider config ownership is redesigned.

Acceptance criteria:

- `src/stock/signals/market-intel.ts` no longer imports provider calibration.
- `src/stock/reports/market-intel.ts` no longer imports provider format helpers.
- Market-intel fixtures continue to prove data quality, evidence IDs, role protocol, scoring, and skip behavior.

Verification:

- `pnpm vitest run src/providers/market-intel src/providers/stock-watchlist-research`
- `pnpm run typecheck`

Rollback:

- Keep old provider `format.ts` and `calibration.ts` as compatibility re-exports if needed.

### Slice 5: Move Forecast Evaluation Calibration Into Signals

Goal: align forecast evaluation reliability, calibration summary, and scoring helpers with the Signal / Intelligence layer.

Target moves:

- Move `src/providers/market-forecast-evaluation/calibration.ts` into `src/stock/signals/forecast-calibration.ts`.
- Keep forecast persistence in `src/store/market-forecasts.ts`.
- Keep `market-forecast-evaluation` provider report generation in `src/stock/reports/forecast-evaluation.ts`.

Acceptance criteria:

- Calibration computation imports from `src/stock/signals/*`, not provider folders.
- Forecast evaluation output and market-intel calibration file generation remain compatible.

Verification:

- `pnpm vitest run src/providers/market-forecast-evaluation src/providers/market-intel`
- `pnpm run typecheck`

Rollback:

- Re-export moved calibration functions from the old provider path until downstream imports are updated.

### Slice 6: Move Broker Report Payload Builders To Stock Sources Or Reports

Goal: remove broker-specific report payload construction from provider folders while keeping readonly safety and redaction intact.

Target moves:

- Move `src/providers/futu-stock/format.ts` into `src/stock/reports/futu-stock-format.ts` or split broker snapshot normalization into `src/stock/sources/futu` and final payload formatting into `src/stock/reports/futu-stock`.
- Move `src/providers/eastmoney-jywg-readonly/format.ts` into `src/stock/reports/eastmoney-jywg-readonly-format.ts` or split source normalization from report formatting.
- Keep MCP/raw broker clients under `src/mcp/*` and source adapter facades under `src/stock/sources/*`.

Acceptance criteria:

- `src/stock/reports/futu-stock.ts` and `src/stock/reports/eastmoney-jywg-readonly.ts` do not import provider format files.
- Redaction and readonly safety tests remain green.
- Exact/private redaction behavior is unchanged for trusted cron configs.

Verification:

- `pnpm vitest run src/mcp/futu-stock src/mcp/eastmoney-jywg src/providers/futu-stock src/providers/eastmoney-jywg-readonly`
- `pnpm run typecheck`

Rollback:

- Leave old provider `format.ts` files as compatibility re-exports for one migration cycle.

### Slice 7: Thin Provider Folders And Tighten Boundaries

Goal: make stock provider folders true cron compatibility facades.

Actions:

- Reduce stock provider folders to `index.ts`, `config.ts`, optional `types.ts` re-export facades, and compatibility tests.
- Decide whether provider `config.ts` stays in `src/providers/*` permanently because config files are provider-named, or whether config loaders move to `src/stock/reports/config/*` with provider facades.
- Update docs to describe the final boundary only after code proves it.
- Add a static dependency check if the repo quality-gate style supports it.

Acceptance criteria:

- A fresh `find src/providers -maxdepth 2 -type f | rg '(stock|market|eastmoney|futu)'` shows no source/data/signal implementation files under provider folders.
- `rg "../../providers|../../../providers|../../../../providers|../../../../../providers" src/stock/sources src/stock/data src/stock/signals --glob '*.ts'` returns no stock-specific provider imports.
- `src/providers/index.ts` remains the only central registry for cron provider names.

Verification:

- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm test`
- `pnpm run e2e:cron`
- `pnpm run quality:docs`

Rollback:

- Restore provider facade re-exports first; avoid changing cron YAML or runtime config paths during rollback.

### Recommended Commit Boundaries

- Commit 1: docs/baseline guard and type ownership move.
- Commit 2: portfolio data and chart ownership cleanup.
- Commit 3: market-intel and forecast calibration cleanup.
- Commit 4: broker payload builder cleanup.
- Commit 5: final provider-folder thinning and docs sync.

Each commit should keep the runtime provider names stable and include the focused test commands for that slice in the final verification notes.

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
- 2026-05-17: Completed the source/data cleanup slice after the compatibility migration. Moved `stock-pulse` universe/source mapping into `src/stock/data/universe.ts` and `src/stock/sources/watchlists.ts`; moved market-intel calendar, quote snapshot, portfolio context, redaction, and official evidence collectors into `src/stock/data/*` and `src/stock/sources/official/collectors/*`; moved Eastmoney ETF premium and Yahoo watchlist research clients into `src/stock/sources/*`. `src/providers/*` still owns cron-facing config/type compatibility and some report-format helpers, so the final report/config cleanup remains a separate slice.
