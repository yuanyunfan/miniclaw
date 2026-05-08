# Stock Cron Market Split And CNY P&L

Status: completed
Date: 2026-05-08

## Background

MiniClaw currently has two stock cron jobs:

- `stock-market-premarket`: Beijing time 09:15, mixed US/A/H premarket report.
- `a-share-hk-postmarket`: Beijing time 15:15, A/H postmarket report.

Both use `pre_provider: stock-portfolio`, which aggregates `futu-stock` and `eastmoney-jywg-readonly`. The existing payload preserves each broker provider output but does not produce a cross-broker CNY-denominated P&L rollup.

The new requirement is to split the reports into four market/session-specific jobs and include unified CNY P&L statistics, including both stocks and ETFs:

- `us-stock-pre-market`
- `us-stock-post-market`
- `cn-stock-pre-market`
- `cn-stock-post-market`

## Goals

- Split stock reports into US and CN Discord channels.
- Use market-local cron time zones:
  - US jobs use `America/New_York`.
  - CN jobs use `Asia/Shanghai`.
- Add provider-side CNY-denominated P&L rollups before the LLM runs.
- Include:
  - gross profit in CNY;
  - gross loss in CNY;
  - net P&L in CNY;
  - per-currency original totals;
  - Top5 CNY gainers;
  - Top5 CNY losers;
  - inferred instrument type for stock vs ETF where possible.
- Keep account identifiers, exact total assets, cookies, tokens, validate keys, passwords, and trade credentials out of Discord output.

## Non-Goals

- No trading endpoints, order placement, cash transfer, or position mutation.
- No account password, trade password, or broker token storage.
- No automatic online FX fetching in the first implementation; rates are explicit local config values so report math is deterministic and auditable.
- No attempt to merge USD/HKD/CNY market value into a full NAV report unless explicitly requested later.

## Existing Architecture Evidence

- `src/cron/scheduler.ts` passes `job.timezone` to `node-cron`.
- `src/cron/runner-task.ts` passes `job.name` into `runPreProvider`, so provider configs can vary by cron job.
- `src/providers/futu-stock/config.ts` and `src/providers/eastmoney-jywg-readonly/config.ts` already support `market_session_by_job`.
- `src/providers/futu-stock/format.ts` and `src/providers/eastmoney-jywg-readonly/format.ts` currently output only `top_positions`, not separate Top gainers/losers or gross profit/loss.
- `src/providers/stock-portfolio/format.ts` currently aggregates source payloads but does not calculate CNY rollups.

## Implementation Plan

1. Extend broker provider payloads.
   - Add `positions_summary.pnl_summary`.
   - Add `positions_summary.top_gainers`.
   - Add `positions_summary.top_losers`.
   - Keep compact fields only: code, name, currency, P&L values, ratio; no quantity or market value.

2. Extend `stock-portfolio` config.
   - Add `market_scope`.
   - Add `base_currency`, default `CNY`.
   - Add `fx_rates`, interpreted as one unit of source currency converted to base currency.
   - Add `fx_rates_as_of` and `fx_rates_source`.
   - Add `top_movers_limit`, default 5.
   - Add `include_cny_summary`, default true.

3. Extend `stock-portfolio` formatter.
   - Read nested broker `pnl_summary` and top gain/loss lists.
   - Convert gross profit/loss/net P&L to CNY.
   - Convert Top5 gainers/losers to CNY.
   - Add warnings if a source currency has no FX rate.
   - Preserve the original per-source payload for traceability.

4. Add focused tests.
   - Broker provider formatter tests for Top gainers/losers and gross stats.
   - Stock portfolio formatter tests for CNY conversion, missing FX warning, and Top5 sorting.
   - Stock portfolio config tests for new fields.

5. Update local runtime configs.
   - Add Futu `us` profile with `trd_market: US` and `currency: USD`.
   - Add provider configs:
     - `~/.miniclaw/providers/futu-stock/us-stock.yaml`
     - `~/.miniclaw/providers/futu-stock/cn-stock.yaml`
     - `~/.miniclaw/providers/eastmoney-jywg-readonly/cn-stock.yaml`
     - `~/.miniclaw/providers/stock-portfolio/us-stock.yaml`
     - `~/.miniclaw/providers/stock-portfolio/cn-stock.yaml`
   - Disable old stock cron jobs.
   - Add four new cron YAML files.

6. Create or reuse Discord channels.
   - `#daily-us-stock`
   - `#daily-cn-stock`

## Verification Plan

- Focused tests:
  - `pnpm vitest run src/providers/futu-stock src/providers/eastmoney-jywg-readonly src/providers/stock-portfolio`
- Type check:
  - `pnpm build`
- Full test:
  - `pnpm test`
- Config load:
  - `pnpm cron:list`
- Provider dry-run without printing financial details:
  - run `stock-portfolio` for `us-stock` and `cn-stock`, print only status counts and summary shape.

## Risks And Rollback

- Risk: Futu US profile may fail if OpenD account permissions do not include US trading.
  - Mitigation: US stock provider config is isolated from CN stock config.
  - Rollback: disable `us-stock-*` cron files.

- Risk: Static FX rates become stale.
  - Mitigation: payload includes `fx_rates_as_of` and `fx_rates_source`; report must state CNY values are based on configured rates.
  - Rollback: set `include_cny_summary: false` or update local FX rates.

- Risk: ETF classification is imperfect.
  - Mitigation: mark `instrument_type` as `etf` only on explicit name/code hints; otherwise `stock`.

## Documentation Sync

- Plan document records the design.
- Provider docs should mention CNY rollup fields after implementation.

## Execution Notes

- Added broker-level `pnl_summary`, `top_gainers`, and `top_losers` to `futu-stock` and `eastmoney-jywg-readonly` provider payloads.
- Added `market_scope`, `base_currency`, `fx_rates`, `fx_rates_as_of`, `fx_rates_source`, `top_movers_limit`, and `include_cny_summary` to `stock-portfolio` provider config.
- Added `stock-portfolio.cny_summary` with CNY gross profit, gross loss, net P&L, per-currency totals, and Top gainers/losers.
- Created private Discord channels:
  - `#daily-us-stock`
  - `#daily-cn-stock`
- Added local provider configs:
  - `~/.miniclaw/providers/futu-stock/us-stock.yaml`
  - `~/.miniclaw/providers/futu-stock/cn-stock.yaml`
  - `~/.miniclaw/providers/eastmoney-jywg-readonly/cn-stock.yaml`
  - `~/.miniclaw/providers/stock-portfolio/us-stock.yaml`
  - `~/.miniclaw/providers/stock-portfolio/cn-stock.yaml`
- Added local cron jobs:
  - `us-stock-pre-market`
  - `us-stock-post-market`
  - `cn-stock-pre-market`
  - `cn-stock-post-market`
- Disabled old local stock cron jobs:
  - `stock-market-premarket`
  - `a-share-hk-postmarket`
- Verification:
  - `pnpm vitest run src/providers/futu-stock src/providers/eastmoney-jywg-readonly src/providers/stock-portfolio`
  - `pnpm build`
  - `pnpm cron:list`
  - `stock-portfolio` dry-run for `us-stock` and `cn-stock`
  - `pnpm test`
