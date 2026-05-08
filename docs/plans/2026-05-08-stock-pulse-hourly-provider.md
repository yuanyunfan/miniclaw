# Stock Pulse Hourly Provider

Status: completed
Date: 2026-05-08

## Requirement

Run an hourly stock anomaly analysis during CN/US trading windows and the user's Beijing-time active window from 09:30 to 01:00. Send US results to `daily-us-stock` and CN/HK results to `daily-cn-stock`.

## Implementation

- Added `stock-pulse` pre-provider.
- Added active-window and market-session guards in provider code.
- Reused `stock-portfolio` for portfolio candidate symbols.
- Added watchlist and universe-source support.
- Added Yahoo chart based 5m intraday bar analysis.
- Added P2 anomaly scoring:
  - 60m return;
  - day return;
  - abnormal 5m bar count;
  - expected abnormal frequency p95;
  - one-way bar count;
  - rolling 60m z-score.
- Added P3 candidate universe:
  - Yahoo predefined screeners for US;
  - Eastmoney clist source type for CN/HK.
- Added local cron jobs:
  - `~/.miniclaw/cron/us-stock-hourly-pulse.yaml`;
  - `~/.miniclaw/cron/cn-stock-hourly-pulse.yaml`.
- Added local provider configs:
  - `~/.miniclaw/providers/stock-pulse/us-hourly.yaml`;
  - `~/.miniclaw/providers/stock-pulse/cn-hourly.yaml`.

## Verification

```bash
pnpm vitest run src/providers/stock-pulse
pnpm build
pnpm cron:list
```

## Notes

The first version intentionally keeps full-market scanning bounded by `universe.max_symbols`. It scans portfolio, watchlist, and public top-mover candidates, then applies the same deterministic bar-level anomaly detector to all candidates.
