# Stock Research Provider Pipeline

> Conclusion: stock research docs should be read as one provider pipeline. `stock-portfolio` creates a redacted account/asset view, `stock-pulse` detects intraday movement, `market-intel` adds macro/evidence context and forecast persistence, and `stock-watchlist-research` produces watchlist-only buy-timing research.

## Pipeline

```mermaid
flowchart LR
  Futu[Futu readonly account] --> Portfolio[stock-portfolio]
  JYWG[Eastmoney JYWG holdings] --> Portfolio
  MyFavor[Eastmoney MyFavor watchlist] --> Universe[watchlist universe]
  FutuWatchlist[Futu watchlist] --> Universe
  Portfolio --> Pulse[stock-pulse alerts]
  Universe --> Pulse
  Pulse --> WatchlistResearch[stock-watchlist-research]
  Portfolio --> MarketIntel[market-intel evidence]
  MarketIntel --> WatchlistResearch
  MarketIntel --> Forecasts[(market_forecasts / items / evaluations)]
  WatchlistResearch --> Discord[daily-watchlist-stock]
  Portfolio --> StockReports[stock account reports]
```

## Stock Portfolio

Runtime name: `stock-portfolio`.

Owner code paths:

```text
src/providers/stock-portfolio/
  config.ts
  index.ts
  format.ts
  pie-chart.ts
  types.ts
```

Purpose:

- Aggregate multiple readonly broker providers before LLM execution.
- Preserve each source's redacted structured payload.
- Compute CNY summaries, top gainers/losers, premium summaries, and optional private-channel asset summaries before the prompt.
- Continue on optional source errors when configured, but fail closed when all required sources fail.

Config example:

```yaml
continue_on_error: true
fail_if_all_sources_fail: true
market_scope: cn
base_currency: CNY
fx_rates:
  CNY: 1
  USD: 7.10
  HKD: 0.91
fx_rates_as_of: "YYYY-MM-DD"
fx_rates_source: manual-public-fx-snapshot
include_cny_summary: true
sources:
  - provider: eastmoney-jywg-readonly
    config: cn-stock
    label: Eastmoney CN
    required: false
  - provider: futu-stock
    config: cn-stock
    label: Futu HK
    required: false
```

Contract:

- `cny_summary` is the reporting source for CNY P&L; LLM reports should not recalculate missing values.
- `asset_summary` is private-channel only and may include exact total assets, cash, market value, holdings amount, and allocation categories.
- `include_asset_totals: false` prevents double-counting integrated broker accounts queried through multiple market profiles.
- Eastmoney premium fields are accepted only from the JYWG holding payload; `stock-portfolio` does not infer premium data from public websites.
- If no source succeeds and `fail_if_all_sources_fail=true`, do not call the LLM.

## Stock Pulse

Runtime name: `stock-pulse`.

Owner code paths:

```text
src/providers/stock-pulse/
  analyzer.ts
  config.ts
  index.ts
  market.ts
  symbols.ts
  watchlist-sources.ts
  yahoo-client.ts
  fixtures/*.json
```

Purpose:

- Scan portfolio and watchlist symbols during active market/user windows.
- Use deterministic quote/bar analysis before asking the LLM to explain alerts.
- Keep account holdings and observation-universe symbols distinct.

Runtime flow:

```text
cron task
  -> pre_provider: stock-pulse
    -> active_window + market session guard
    -> stock-portfolio for held symbols
    -> manual watchlist and optional universe sources
    -> Yahoo chart 5m / 60d bars
    -> anomaly scoring
    -> alerts[] + position_groups[] + run_context
```

Anomaly signals:

- `hour_move`
- `day_move`
- `abnormal_frequency`
- `one_way_bars`
- `z_score`

Severity levels:

- `notice`: one lightweight trigger.
- `alert`: two or more triggers.
- `urgent`: urgent z-score, large day move, or abnormal 5m-bar count above expected p95.

Universe sources:

- `futu_watchlist`: local Futu OpenD + official SDK watchlist groups.
- `eastmoney_myfavor_watchlist`: Eastmoney MyFavor readonly groups and securities.
- `yahoo_screener`: public predefined US screeners.
- `eastmoney_clist`: public CN/HK movers.

Universe rows are observation candidates. They must not be described as account holdings.

## Market Intel

Runtime names:

- `market-intel`
- `market-forecast-evaluation`
- `market-calibration`

Owner code paths:

```text
src/providers/market-intel/**
src/providers/market-forecast-evaluation/**
src/store/market-forecasts.ts
```

Purpose:

- Collect structured market evidence before the LLM writes pre-market reports.
- Make evidence auditable with source IDs, source tiers, capture times, and freshness.
- Persist forecast JSON and evaluate only appropriate forecast horizons.
- Keep market research separate from trading execution.

Evidence source policy:

- Default/primary: SEC, BLS, Treasury, Federal Reserve, Cboe history, PBOC, NBS, SSE, SZSE, HKEX, and Futu OpenD where permissions are available.
- Optional: FRED API, Polygon, Tushare when local credentials exist.
- Fallback-only: Yahoo chart and Eastmoney public endpoints, with `data_quality` downgrade.
- Excluded from default: Stooq and AKShare.

Forecast persistence:

- `market_forecasts`: provider payload, final report text, and run context.
- `market_forecast_items`: same-day probabilities, horizon probabilities, sector opportunities, and risk alerts.
- `market_forecast_evaluations`: post-market benchmark outcomes, hit/miss, Brier score, and calibration notes.

Horizon contract:

- `horizon_probabilities`, `horizon_sector_opportunities`, and `horizon_risk_alerts` are medium/long horizon items (`1m`, `3m`, `6m`, `1y`).
- Same-day hit/miss and Brier score require an explicit same-day `index_probability`.
- Horizon-only forecasts should report `status=horizon_only` and skip same-day evaluation.

## Stock Watchlist Research

Runtime name: `stock-watchlist-research`.

Owner code paths:

```text
src/providers/stock-watchlist-research/
  config.ts
  index.ts
  research-client.ts
  types.ts
```

Purpose:

- Research broker watchlist symbols that are not already held.
- Use `stock-pulse.universe.sources` for enabled Futu / Eastmoney MyFavor watchlist sources.
- Exclude held symbols using the linked `stock-portfolio` config without exposing excluded holding symbols downstream.
- Add quote, profile, fundamentals, news, and optional portfolio-free `market-intel` context.

Output contract:

- `run_context.watchlist_only=true` must be present.
- `watchlist_source.portfolio_filter` can report counts and config names, but not excluded holding codes.
- `symbols[]` contains quote/profile/financials/news evidence for watchlist-only symbols.
- `market_context` must remove `portfolio_provider_config`; watchlist research should not output account assets, costs, P&L, or holding quantities.
- Buy-timing labels are constrained to: `worth_small_starter`, `wait_for_pullback`, `not_buyable_now`, and `watch_only`.

Cron example:

```yaml
channel: "<daily-watchlist-stock channel id>"
pre_provider: stock-watchlist-research
pre_provider_config: us-pre-market
pre_provider_preflight: health
```

## Report Boundaries

- Portfolio/account reports may mention held positions and P&L when they target trusted private stock channels.
- Watchlist research must not imply that watchlist symbols are holdings.
- Market-intel probabilities are research inputs, not trading instructions.
- No provider in this pipeline may unlock trading, place orders, modify orders, or move funds.

## Legacy Compatibility

The previous feature-level stock research docs are compatibility stubs for one migration cycle:

- [`../../features/10-stock-portfolio-provider.md`](../../features/10-stock-portfolio-provider.md)
- [`../../features/11-stock-pulse-provider.md`](../../features/11-stock-pulse-provider.md)
- [`../../features/14-market-intel-provider.md`](../../features/14-market-intel-provider.md)
- [`../../features/18-stock-watchlist-research-provider.md`](../../features/18-stock-watchlist-research-provider.md)

New implementation facts should be added here or to stock source family docs such as [`eastmoney.md`](eastmoney.md).

Verification owner:

```bash
pnpm vitest run src/providers/stock-portfolio src/providers/stock-pulse src/providers/market-intel src/providers/market-forecast-evaluation src/providers/stock-watchlist-research
pnpm run quality:docs
pnpm run typecheck
pnpm run lint
pnpm cron:list
```
