# Market Intelligence Pre-Market Research Automation

Status: draft
Date: 2026-05-10

## Background

MiniClaw already has stock-related scheduled jobs for US and CN/A/H markets, including pre-market, post-market, intraday pulse, and daily asset summary jobs. The current pre-market jobs are useful, but their design is still mostly `stock-portfolio` plus a large natural-language prompt. That means the LLM must both collect facts and reason about them in the same step, which makes the report harder to audit, harder to reproduce, and more vulnerable to stale or inconsistent web evidence.

The target change is to upgrade the pre-market workflow into a durable market intelligence pipeline:

```text
cron
  -> market calendar guard
  -> deterministic provider data collection
  -> structured evidence JSON
  -> multi-role LLM analysis
  -> forecast editor synthesis
  -> Discord report
  -> post-market evaluation and calibration
```

The key principle is: provider code collects and timestamps evidence; the LLM reasons over the evidence and must cite which evidence supports each conclusion. Token budget should be spent on synthesis, scenario analysis, and risk assessment, not on repeatedly rediscovering basic market facts.

This is analysis-only automation. It must not place orders, unlock trading, store trading passwords, generate automatic trade instructions, or call any trading endpoint.

## Goals

1. Produce one deep CN/A/H pre-market report before China/HK market open on each valid trading day.
2. Produce one deep US pre-market report before US regular session open on each valid trading day.
3. Use a structured `market-intel` pre-provider so the LLM receives timestamped evidence instead of ad hoc search results.
4. Preserve the user's existing portfolio context by reusing `stock-portfolio` data.
5. Separate market direction, sector opportunity, catalyst, and risk views into explicit analyst roles.
6. Add a final forecast editor layer that converts role output into calibrated probabilities and actionable monitoring points.
7. Store forecasts and post-market evaluations so accuracy can be measured over time.
8. Fail closed or downgrade clearly when key data sources are missing, stale, or inconsistent.
9. Keep all account, broker, token, cookie, and session data out of Discord and LLM-visible output unless already safely redacted by existing providers.

## Non-Goals

- Do not build an automatic trading system.
- Do not expose buy/sell/order/unlock tools to LLMs.
- Do not promise deterministic daily market prediction accuracy.
- Do not rely on manual export of broker data.
- Do not require the user to manually copy data before each run.
- Do not scrape authenticated websites when an official or stable read-only API path exists.
- Do not replace existing `stock-portfolio`, `stock-pulse`, Futu, or Eastmoney providers unless their current boundaries block this work.
- Do not send exact private asset totals to public stock channels.
- Do not evaluate personal financial suitability; the report is market research and risk monitoring, not personalized investment advice.

## Existing Architecture Evidence

Relevant cron/runtime files:

- `src/cron/types.ts`
  - `CronJobTask` supports `pre_provider` and `pre_provider_config`.
  - A task can inject provider output before the LLM prompt.
- `src/cron/loader.ts`
  - Validates cron YAML files under `~/.miniclaw/cron`.
  - Rejects unknown providers through `isPreProviderName`.
- `src/cron/runner-task.ts`
  - Runs `pre_provider`, prepends provider text to the task prompt, then calls `executeTask`.
  - Supports provider attachments and provider-side skip semantics.
- `src/cron/scheduler.ts`
  - Schedules jobs, prevents overlapping runs, records run state, retries failures, and sends failure alerts.
- `src/providers/index.ts`
  - Central provider registry. `market-intel` should be added here.

Existing stock provider files:

- `src/providers/stock-portfolio/*`
  - Aggregates read-only broker/provider data.
  - Computes CNY summary and top gainers/losers.
  - Can fail closed when all sources fail.
- `src/providers/stock-pulse/*`
  - Performs deterministic intraday anomaly detection from 5m bars.
  - Separates provider-side anomaly detection from LLM explanation.
- `src/providers/futu-stock/*`
  - Existing read-only broker path.
- `src/providers/eastmoney-jywg-readonly/*`
  - Existing Eastmoney read-only path.

Current user-level cron jobs:

- `~/.miniclaw/cron/us-stock-pre-market.yaml`
  - Runs at `09:00 America/New_York` on weekdays.
  - Uses `pre_provider: stock-portfolio`.
- `~/.miniclaw/cron/cn-stock-pre-market.yaml`
  - Runs at `09:00 Asia/Shanghai` on weekdays.
  - Uses `pre_provider: stock-portfolio`.
- `~/.miniclaw/cron/us-stock-hourly-pulse.yaml`
  - Uses `stock-pulse` during US trading hours.
- `~/.miniclaw/cron/cn-stock-hourly-pulse.yaml`
  - Uses `stock-pulse` during CN/HK trading hours.

Relevant commands:

```bash
pnpm cron:list
pnpm cron:test us-stock-pre-market
pnpm cron:test cn-stock-pre-market
pnpm vitest run src/providers/stock-portfolio src/providers/stock-pulse
pnpm build
```

## Market Timing Requirements

US market:

- Regular NYSE/Nasdaq session is normally 09:30-16:00 Eastern Time.
- Suggested pre-market report trigger: `08:45 America/New_York`.
- The provider must handle US market holidays, early closes, and daylight saving time.
- If the day is a market holiday or early close, the report should either skip or explicitly label the special session.

CN/A/H markets:

- A-share continuous trading window is generally 09:30-11:30 and 13:00-15:00 Asia/Shanghai.
- HKEX securities market includes pre-opening around 09:00-09:30 and continuous trading 09:30-12:00 and 13:00-16:00 Asia/Hong_Kong.
- Suggested report trigger: `08:45 Asia/Shanghai`.
- The provider must support A-share and HK market holidays independently. China and Hong Kong holiday calendars often diverge.
- If only one of A-share or HK is open, the report should still run but mark the closed market clearly.

Reference sources to verify timing and calendars during implementation:

- NYSE hours and calendars: https://www.nyse.com/markets/hours-calendars
- Nasdaq market activity and trading hours references: https://www.nasdaq.com/market-activity
- HKEX trading hours: https://www.hkex.com.hk/Services/Trading-hours-and-Severe-Weather-Arrangements/Trading-Hours/Securities-Market
- SSE / SZSE rules and holiday notices should be treated as the authoritative China-side references when available.

## Target Analyst Roles

The daily report should use five analyst perspectives plus one editor. These should be prompt-level roles first. They do not need to become MiniClaw subagent files unless later implementation shows a real benefit.

### 1. Global Macro, Policy & Liquidity Analyst

Responsibilities:

- US: Fed, Treasury yields, dollar, inflation, labor data, FOMC calendar, fiscal/geopolitical shocks.
- China: PBOC liquidity, policy headlines, NBS macro releases, RMB fixing and offshore RMB movement.
- Output whether macro and liquidity conditions are risk-on, neutral, or risk-off for the day.

Required evidence:

- Economic event calendar.
- Rate/yield movement.
- FX movement.
- Central bank or policy headline evidence.

### 2. Flow, Positioning & Technical Analyst

Responsibilities:

- US: index futures, VIX, sector ETF pre-market direction, breadth, major ETF gaps, volatility regime.
- CN/A/H: A50, Hang Seng futures, Hang Seng TECH, CNH/CNY, northbound/southbound clues when available, ADR/H-share mapping, index technical levels.
- Technical analysis must be secondary to flow and positioning. Support/resistance alone is not enough.

Required evidence:

- Index/futures/ETF snapshot.
- Volatility snapshot.
- Market breadth or top mover snapshot when available.
- Stale/missing data warning if real-time data is unavailable.

### 3. Cross-Market Sector & Theme Strategist

Responsibilities:

- Identify sectors or themes with the best risk/reward setup for the day.
- Map US themes to CN/A/H exposures where relevant, such as AI semiconductors, energy, banks, consumer, healthcare, real estate chain, gold, defense, and new energy.
- Separate "watchlist opportunity" from "already-confirmed momentum".

Required evidence:

- Sector ETF or industry index movement.
- News/catalyst support.
- Portfolio exposure impact if the user holds related assets.

### 4. Earnings, Valuation & Catalyst Analyst

Responsibilities:

- Track earnings, guidance, analyst revisions, buybacks, major announcements, and high-index-weight company events.
- For China and HK, track earnings previews, exchange announcements, regulatory notices, policy-sensitive company news, and overnight ADR movement.
- Explain which catalysts can affect indices versus only single names.

Required evidence:

- Earnings calendar or filing/announcement data.
- Company news or SEC/exchange filing links.
- Index weight or sector exposure if available.

### 5. Risk, Scenario & Devil's Advocate Lead

Responsibilities:

- Challenge the base case.
- List the most likely ways the forecast can fail.
- Identify crowded trades, hidden macro risk, policy headline risk, liquidity events, data-release risk, and tail risks.
- Require invalidation triggers for every high-conviction call.

Required evidence:

- Risk flags from provider.
- Missing or stale data warnings.
- Macro/event calendar risk.
- Volatility or liquidity stress signals.

### 6. Forecast Editor

Responsibilities:

- Merge the five role views.
- Resolve contradictions explicitly.
- Convert the report into probabilities and monitoring points.
- Prevent unsupported claims from entering the final conclusion.

Output requirements:

- Direction probabilities for major indices:
  - `up`
  - `range_bound`
  - `down`
- Split open direction and full-day close direction when evidence differs.
- Top sector opportunities with confidence and triggers.
- Risk watchlist with invalidation points.
- Data quality summary.

## Final Report Contract

Each pre-market report should use this structure:

```markdown
# US/CN Pre-Market Report - YYYY-MM-DD

## Executive View

- Index probability:
- Risk regime:
- Highest-conviction sector/theme:
- Biggest downside risk:
- Data quality:

## Portfolio Impact First

- Holdings or ETFs most exposed today:
- Positive catalysts:
- Negative catalysts:
- Watch triggers:

## Analyst Panels

### Macro, Policy & Liquidity
### Flow, Positioning & Technical
### Sector & Theme Strategy
### Earnings, Valuation & Catalyst
### Risk & Devil's Advocate

## Forecast Editor Synthesis

- Base case:
- Upside case:
- Downside case:
- Invalidation triggers:

## Sector Opportunities

For each opportunity:
- Theme:
- Evidence:
- Trigger:
- Risk:
- Confidence:

## Risk Alerts

For each alert:
- Risk:
- Evidence:
- Trigger:
- Impact:
- What would reduce the risk:

## Data Quality And Sources

- Fresh sources:
- Stale sources:
- Missing sources:
- Provider warnings:
```

The report should not say "buy", "sell", or "must trade" unless the user explicitly asks for trading instructions. Default wording should be watchlist and risk-control oriented:

- "重点观察"
- "若 X 发生，则 Y 风险上升"
- "若 X 被证伪，则降低该判断权重"
- "不建议仅凭该信号行动"

## Provider Design

Add a new provider:

```text
src/providers/market-intel/
  index.ts
  config.ts
  types.ts
  calendar.ts
  scoring.ts
  format.ts
  collectors/
    portfolio.ts
    quotes.ts
    macro.ts
    news.ts
    earnings.ts
    filings.ts
    sector.ts
  __tests__/
    config.test.ts
    calendar.test.ts
    format.test.ts
    scoring.test.ts
    index.test.ts
```

Register it in:

```text
src/providers/index.ts
```

User-level configs:

```text
~/.miniclaw/providers/market-intel/us-pre-market.yaml
~/.miniclaw/providers/market-intel/cn-pre-market.yaml
```

### Provider Input Config

Suggested config shape:

```yaml
market_scope: us # us | cn
session: pre_market
timezone: America/New_York
portfolio_provider_config: us-stock

calendar:
  provider: static_plus_remote
  holidays:
    - "2026-01-01"
  early_closes: []
  fail_on_unknown_trade_date: false

sources:
  quotes:
    us_primary: futu_opend
    hk_primary: futu_opend
    cn_a_primary: eastmoney_public_fallback
    fallback:
      - yahoo_chart_unofficial
    optional_paid:
      - polygon
  macro:
    federal_reserve: official_html_rss
    treasury: official_xml_or_fiscaldata
    bls: official_public_api
    fred: optional_api_key_or_graph_csv
  news:
    provider: official_first_web_fallback
    max_items: 40
  earnings:
    provider: sec_edgar
    max_items: 40
  sectors:
    provider: yahoo_or_polygon

watchlists:
  indices:
    - SPY
    - QQQ
    - IWM
  sectors:
    - XLK
    - XLF
    - XLE
    - XLV
  macro:
    - DXY
    - VIX
    - US10Y
    - WTI
    - GOLD

quality:
  max_stale_minutes:
    quote: 20
    news: 720
    macro: 10080
  fail_if_all_quotes_fail: true
  allow_partial_news: true
```

CN/A/H config should use market-specific symbols and sources:

```yaml
market_scope: cn
session: pre_market
timezone: Asia/Shanghai
portfolio_provider_config: cn-stock

watchlists:
  indices:
    - "000001.SS" # SSE Composite, exact provider symbol may differ
    - "399001.SZ" # SZSE Component, exact provider symbol may differ
    - "^HSI"
    - "^HSTECH"
  cross_market:
    - "A50"
    - "CNH"
    - "HSI_FUTURES"
  sectors:
    - semiconductor
    - ai
    - broker
    - real_estate
    - consumer
    - healthcare
    - new_energy
```

### Provider Output Schema

The provider should return JSON with source IDs. The LLM prompt must require evidence IDs for conclusions.

```ts
export interface MarketIntelPayload {
  generated_at: string;
  source: "market-intel";
  profile: string;
  market_scope: "us" | "cn";
  run_context: {
    trade_date: string;
    timezone: string;
    session: "pre_market";
    calendar_status: "open" | "closed" | "partial" | "unknown";
    open_markets: string[];
    closed_markets: string[];
    skip_reason?: string;
  };
  portfolio?: unknown;
  market_snapshot: {
    indices: MarketDataPoint[];
    futures: MarketDataPoint[];
    sector_etfs_or_indices: MarketDataPoint[];
    rates: MarketDataPoint[];
    fx: MarketDataPoint[];
    commodities: MarketDataPoint[];
    volatility: MarketDataPoint[];
  };
  macro_calendar: EvidenceItem[];
  policy_and_liquidity: EvidenceItem[];
  news: EvidenceItem[];
  earnings_and_catalysts: EvidenceItem[];
  sector_signals: SectorSignal[];
  risk_flags: RiskFlag[];
  scores: {
    risk_regime: "risk_on" | "neutral" | "risk_off" | "mixed";
    macro_score: number;
    flow_score: number;
    sector_breadth_score: number;
    volatility_score: number;
    data_quality_score: number;
  };
  data_quality: {
    fresh: string[];
    stale: string[];
    missing: string[];
    warnings: string[];
  };
  usage_notes: string[];
}
```

Recommended primitive types:

```ts
export interface MarketDataPoint {
  id: string;
  symbol: string;
  name?: string;
  value?: number;
  change_pct?: number;
  change_abs?: number;
  currency?: string;
  captured_at: string;
  source: string;
  stale: boolean;
}

export interface EvidenceItem {
  id: string;
  title: string;
  summary: string;
  captured_at: string;
  published_at?: string;
  source: string;
  url?: string;
  symbols?: string[];
  sectors?: string[];
  importance: "low" | "medium" | "high";
  freshness: "fresh" | "stale" | "unknown";
}

export interface SectorSignal {
  id: string;
  sector: string;
  direction: "positive" | "neutral" | "negative" | "mixed";
  evidence_ids: string[];
  confidence: number;
}

export interface RiskFlag {
  id: string;
  risk: string;
  severity: "notice" | "alert" | "urgent";
  evidence_ids: string[];
  invalidation?: string;
}
```

## Data Source Strategy

### Validation Summary

Validation was run before implementation on 2026-05-10. The validation combined official documentation review with live endpoint probes from this machine. The result changes the implementation policy:

- Use official or locally authenticated read-only sources as defaults.
- Treat paid/API-key sources as optional accelerators, not baseline dependencies.
- Treat undocumented public endpoints as fallback only, even if they currently work.
- Do not use generic web search as a structured market-data source; use it only for supplemental news discovery with source dedupe.
- Do not use a source for critical claims unless it has a successful probe, an official document, or an explicit fallback/caveat.

Live probe results from this machine:

- SEC EDGAR submissions and companyfacts JSON: reachable and field-valid for AAPL.
- BLS Public Data API v2: reachable without a key for a small CPI request.
- U.S. Treasury daily yield XML: reachable and contains 10Y yield fields.
- FRED official API without key: rejected. FRED graph CSV for `DGS10`: reachable.
- Federal Reserve press RSS and FOMC calendar page: reachable.
- Cboe VIX history CSV: reachable. This is daily historical VIX, not a real-time VIX quote source.
- PBOC open market operations page: reachable.
- NBS English latest releases page: reachable.
- SSE English trading calendar: reachable.
- SZSE English calendar page was unreliable from Node fetch, but the official `szse.cn/api/report/exchange/onepersistenthour/monthList` JSON endpoint returned 2026-05 trading-day flags.
- HKEX trading-hours page: reachable.
- Futu OpenD health: reachable on `127.0.0.1:11111`; Python `futu-api` / `moomoo` package available.
- Futu quote snapshot probe: US and HK snapshots succeeded; A-share snapshots failed due to missing A-share market data permission on this machine.
- Yahoo chart endpoint: reachable for AAPL, but it is undocumented/unofficial.
- Eastmoney `push2` clist endpoint: reachable, but it is undocumented/unofficial.
- Local `FRED_API_KEY`, `POLYGON_API_KEY`, `TUSHARE_TOKEN`, `FINNHUB_API_KEY`, and `ALPHAVANTAGE_API_KEY`: not configured at validation time.
- Local `akshare` and `tushare` Python packages: not installed at validation time.

### Source Quality Tiers

#### Tier A: Default Sources

These are stable enough for first-class provider support.

- Federal Reserve official pages/RSS:
  - Metrics: FOMC calendar, policy statements, press releases, speeches.
  - Access pattern: HTML/RSS parsing.
  - Caveat: authoritative but not a clean JSON API; parser tests and page-shape monitoring are required.
- U.S. Treasury official feeds / Fiscal Data:
  - Metrics: Treasury yield curve and daily rates.
  - Access pattern: XML feed or Fiscal Data API where the dataset endpoint is available.
  - Use as the primary source for US yields instead of FRED when possible.
- BLS Public Data API:
  - Metrics: CPI, PPI, unemployment rate, payrolls, wages, other known BLS series IDs.
  - Access pattern: JSON API. Small public requests work without a key; a key can increase limits.
- SEC EDGAR official APIs:
  - Metrics: recent filings, 8-K/10-Q/10-K/20-F/6-K, XBRL company facts for tracked companies.
  - Access pattern: JSON APIs under `data.sec.gov`; always send a declared User-Agent.
- Cboe official VIX history:
  - Metrics: daily historical VIX close/open/high/low.
  - Access pattern: official CSV.
  - Caveat: do not use as the only source for live pre-market VIX; pair with Futu/Polygon/Yahoo quote where available.
- PBOC official open market operations pages:
  - Metrics: OMO announcements, reverse repo amounts/rates, policy/liquidity headlines.
  - Access pattern: official HTML pages.
  - Caveat: parser must be defensive because this is not a JSON API.
- NBS official latest releases:
  - Metrics: CPI, PPI, PMI, industrial production, retail sales, fixed asset investment headlines/releases.
  - Access pattern: official HTML release pages.
  - Caveat: use for release monitoring and latest official values; do not assume a stable English JSON API.
- SSE official trading calendar:
  - Metrics: Shanghai market open/closed days.
  - Access pattern: official English trading schedule page plus static override cache.
- SZSE official trading-day JSON:
  - Metrics: Shenzhen trading-day flags by month.
  - Access pattern: `szse.cn/api/report/exchange/onepersistenthour/monthList?month=YYYY-MM`.
  - Caveat: keep fixture tests and fallback static calendar because the English page probe was unreliable.
- HKEX official trading hours / market calendar references:
  - Metrics: HK securities trading sessions, half-day rules, holiday/session rules.
  - Access pattern: official pages plus static override cache.
- Futu OpenD:
  - Metrics: US/HK quote snapshots, local account/portfolio context through existing read-only provider, and potentially candles if local permissions allow.
  - Access pattern: local OpenD + Python API.
  - Validation result: US/HK snapshots work; A-share quote permission is not available on this machine, so do not make Futu the default CN-A quote source.

#### Tier B: Optional High-Quality Sources

Use these only when credentials or local packages are explicitly configured.

- Polygon:
  - Metrics: US stock/ETF snapshots, aggregates, market status, ticker news.
  - Quality: good API shape and commercial market-data source.
  - Current status: no `POLYGON_API_KEY` configured. Do not make it a baseline dependency.
- FRED:
  - Metrics: broad macro time series.
  - Quality: high-quality official Federal Reserve Bank of St. Louis source.
  - Current status: official API requires an API key; local `FRED_API_KEY` is missing. Public graph CSV works and can be used as a fallback for selected non-critical series.
- Tushare Pro:
  - Metrics: CN trading calendar, daily market data, fundamentals, daily basics.
  - Quality: structured API, but token/points gated.
  - Current status: no `TUSHARE_TOKEN` and package not installed. Optional only.

#### Tier C: Fallback-Only Sources

These can fill gaps but must never be the sole basis for high-confidence conclusions.

- Yahoo chart endpoint:
  - Validation result: AAPL chart endpoint worked.
  - Problem: unofficial/undocumented, rate-limit and cookie behavior can change.
  - Allowed use: fallback quotes/candles for low request volume, always marked as `unofficial`.
- Eastmoney public `push2` endpoints:
  - Validation result: A-share clist endpoint worked.
  - Problem: undocumented public endpoint with no official stability guarantee.
  - Allowed use: CN-A quote/sector/top-mover fallback until a better configured source is available; critical conclusions require cross-check with another source when possible.
- AKShare:
  - Problem: community wrapper over many heterogeneous public sources; local package not installed.
  - Allowed use: development helper or explicitly configured fallback, not production default.
- Stooq:
  - Problem: no official API; mostly useful for historical/EOD backfill.
  - Decision: remove from pre-market default source list. It can be used only for backtests or fixtures.
- Generic web search:
  - Problem: inconsistent ranking, duplicate syndication, and variable source quality.
  - Allowed use: supplemental news discovery only; every item must be source-deduped and assigned freshness/importance.

### US Sources

Default source plan:

- Calendar and session:
  - NYSE/Nasdaq official pages plus static holiday/early-close cache.
- Rates:
  - U.S. Treasury official XML/API first.
  - FRED only for additional historical macro series when configured or for selected graph CSV fallbacks.
- Inflation/labor:
  - BLS Public Data API for known CPI/PPI/employment/wage series IDs.
- Fed policy:
  - Federal Reserve FOMC calendar, press releases, and RSS feeds.
- Filings and company catalysts:
  - SEC EDGAR submissions/companyfacts APIs for tracked tickers mapped to CIKs.
- Volatility:
  - Cboe official VIX history for daily context.
  - Futu/Polygon/Yahoo quote source for current VIX-like snapshot, with source quality label.
- US stock/ETF/index quotes:
  - Futu OpenD as local primary if permissions cover the instrument.
  - Polygon if API key is configured.
  - Yahoo chart as fallback only.

Implementation priority:

1. Market calendar and quote snapshot.
2. Volatility, rates, FX, commodities.
3. Economic calendar and key macro releases.
4. Earnings and company catalyst collector.
5. Sector ETF or industry index movement.
6. News search fallback with source deduplication.

### CN/A/H Sources

Default source plan:

- Calendar and session:
  - SSE official trading schedule for Shanghai.
  - SZSE official `monthList` JSON for Shenzhen.
  - HKEX official pages plus static holiday/half-day override cache for Hong Kong.
- China policy/liquidity:
  - PBOC official OMO/policy pages.
- China macro:
  - NBS official latest releases for CPI/PPI/PMI/industrial production/retail/FAI.
- HK/US-linked cross-market signals:
  - Futu OpenD for HK and US quotes where permissions allow.
  - HKEX official references for HK trading sessions and special-session rules.
- CN-A quotes and sector/top movers:
  - Futu A-share quote permission is not available on this machine.
  - Use Eastmoney public endpoints only as fallback and mark them `unofficial`.
  - Prefer Tushare Pro only if token/package is later configured.
- Account/portfolio context:
  - Keep using `stock-portfolio`, which already aggregates redacted Futu and Eastmoney read-only account data.

Implementation priority:

1. CN/HK calendar guard.
2. A-share/HK index and futures/cross-market snapshot.
3. RMB/CNH and offshore risk signals.
4. PBOC/NBS/policy headlines.
5. Sector/theme movement.
6. Company announcements and earnings previews.

### Excluded From Default Implementation

These sources should not be part of the default first implementation:

- Stooq for pre-market live decisions.
- AKShare as production default.
- Tushare unless `TUSHARE_TOKEN` is configured and tests prove the exact endpoints needed.
- Polygon unless `POLYGON_API_KEY` is configured.
- FRED official API unless `FRED_API_KEY` is configured; selected graph CSV fallbacks are acceptable for non-critical historical context.
- Nasdaq web pages as a structured data source. They can be supplemental references, not provider inputs.

## Scoring And Forecasting

The provider should compute deterministic scores. The LLM should interpret them, not invent them.

Suggested score range: `-2` to `+2`.

Market dimensions:

- `macro_score`
  - Rates, FX, policy, economic data surprises.
- `flow_score`
  - Index futures, cross-market leads, ETF movement, breadth, northbound/southbound clues if available.
- `volatility_score`
  - VIX or local volatility proxies.
- `sector_breadth_score`
  - Number and strength of positive/negative sectors.
- `earnings_catalyst_score`
  - Net effect of major earnings/catalysts.
- `data_quality_score`
  - Penalty for stale or missing critical sources.

Forecast editor converts evidence and analyst views into probabilities:

```text
up_probability + range_probability + down_probability = 100%
```

Rules:

- No index probability should exceed 70% unless at least three independent evidence groups align.
- If quote data is stale, max confidence is capped.
- If major data release is pending before or shortly after open, confidence must be reduced.
- Sector opportunities need at least two evidence groups, such as `price/flow + catalyst`, or `macro + earnings`, or `portfolio exposure + sector momentum`.
- Every high-confidence sector opportunity needs an invalidation trigger.

## Forecast Persistence And Evaluation

Add forecast persistence after the first provider/report prototype works.

Suggested tables:

```sql
CREATE TABLE market_forecasts (
  id TEXT PRIMARY KEY,
  market_scope TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  session TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  calendar_status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  report_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE market_forecast_items (
  id TEXT PRIMARY KEY,
  forecast_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  target TEXT NOT NULL,
  direction TEXT NOT NULL,
  probability REAL,
  confidence REAL,
  evidence_ids_json TEXT,
  invalidation TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (forecast_id) REFERENCES market_forecasts(id)
);

CREATE TABLE market_forecast_evaluations (
  id TEXT PRIMARY KEY,
  forecast_id TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  outcome_json TEXT NOT NULL,
  score_json TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (forecast_id) REFERENCES market_forecasts(id)
);
```

Evaluation metrics:

- Direction hit rate:
  - Did the dominant probability bucket match the final index move?
- Open gap hit:
  - Did the report correctly anticipate opening direction?
- Full-day close hit:
  - Did the report correctly anticipate close direction?
- Brier score:
  - Measures probability calibration rather than only yes/no correctness.
- Sector hit rate:
  - Did selected sector/theme outperform relevant benchmark?
- Risk trigger quality:
  - Did flagged risks occur?
  - Were false positives excessive?
- Data quality correlation:
  - Compare lower-confidence reports with actual miss rate.

Post-market jobs can evaluate the morning forecast and append a short calibration note:

```text
Today forecast:
- Index direction: miss/hit
- Sector calls: 2/4 hit
- Biggest missed factor:
- Data issue:
- Prompt/scoring adjustment candidate:
```

## Cron Configuration Plan

Update existing jobs rather than creating duplicates.

US:

```yaml
name: us-stock-pre-market
schedule: "45 8 * * 1-5"
timezone: America/New_York
enabled: true
type: task
channel: "1502184539915681823"
pre_provider: market-intel
pre_provider_config: us-pre-market
prompt: |
  你是我的美股盘前市场研究总编。上方 JSON 来自 `market-intel` provider，
  包含市场日历、行情快照、宏观/政策/财报/新闻/行业/风险证据，以及我的持仓脱敏上下文。
  必须基于 evidence id 输出分析，禁止编造 provider 没有给出的实时数据。
  ...
```

CN/A/H:

```yaml
name: cn-stock-pre-market
schedule: "45 8 * * 1-5"
timezone: Asia/Shanghai
enabled: true
type: task
channel: "1502184541807181906"
pre_provider: market-intel
pre_provider_config: cn-pre-market
prompt: |
  你是我的 A 股/港股盘前市场研究总编。上方 JSON 来自 `market-intel` provider，
  包含 A/H 市场日历、跨市场行情、政策/宏观/公告/行业/风险证据，以及我的持仓脱敏上下文。
  必须基于 evidence id 输出分析，禁止编造 provider 没有给出的实时数据。
  ...
```

Calendar behavior:

- If all relevant markets are closed, provider returns `skipTask` with optional quiet skip.
- If only part of the market is closed, provider runs and labels the open/closed market split.
- If critical quote collection fails, provider fails closed for that job unless configured otherwise.
- If news/earnings collection fails, provider can continue with warnings.

## Prompt Protocol

The cron prompt should enforce this protocol:

1. Read `data_quality` first.
2. If `run_context.calendar_status=closed`, output only a short closed-market status unless provider explicitly says to continue.
3. Use the role sections in order:
   - Macro, Policy & Liquidity
   - Flow, Positioning & Technical
   - Cross-Market Sector & Theme
   - Earnings, Valuation & Catalyst
   - Risk, Scenario & Devil's Advocate
4. Each role must list:
   - conclusion
   - evidence IDs
   - confidence
   - what would change its view
5. Forecast Editor must produce final probabilities.
6. Any unsupported claim must be marked as hypothesis, not fact.
7. Never output account IDs, raw broker payloads, tokens, cookies, validatekey, phone numbers, or session data.
8. Do not recommend automatic trades.

## Implementation Plan

### Phase 0: Planning And Fixture Design

1. Add this plan document.
2. Validate source quality and live endpoint availability before writing provider code.
3. Define `MarketIntelPayload` and fixture examples for US and CN.
4. Decide initial data source list that can run zero-touch on this machine.
5. Confirm which quote source is available for US/CN/HK without manual login.

Exit criteria:

- Plan is in `docs/plans`.
- Initial schema is reviewed.
- Source choices are explicit and not hidden in prompts.
- Low-quality or unconfigured sources are excluded from defaults or marked fallback/optional.

### Phase 1: Provider Skeleton

1. Create `src/providers/market-intel/`.
2. Add config loader and validation.
3. Add calendar guard.
4. Add placeholder collectors returning fixture-like structured sections.
5. Register provider in `src/providers/index.ts`.
6. Add tests for config, calendar, and formatting.

Exit criteria:

- `pnpm vitest run src/providers/market-intel` passes.
- Provider can be invoked through a cron test fixture.
- Missing config fails with a clear error.

### Phase 2: Portfolio Integration

1. Call `stock-portfolio` inside `market-intel` when `portfolio_provider_config` is set.
2. Preserve `stock-portfolio` warnings and data quality.
3. Make sure CNY summary appears early in provider output to avoid truncation.
4. Add redaction test to prevent broker secrets or account identifiers from leaking.

Exit criteria:

- US and CN market-intel configs can include portfolio context.
- If portfolio partially fails, report can continue when config allows.
- If all required portfolio sources fail, provider fails closed.

### Phase 3: Market Snapshot Collectors

1. Implement quote snapshot collector.
2. Add US index/futures/ETF/volatility/rate/FX/commodity watchlist support.
3. Add CN/A/H index/cross-market/sector watchlist support.
4. Add stale data detection by collector type.
5. Add deterministic score calculation.

Exit criteria:

- Provider produces `market_snapshot` and `scores`.
- Stale/missing data is visible in `data_quality`.
- Tests cover partial quote failures and stale data.

### Phase 4: Macro, Policy, News, Earnings, And Filings

1. Add US official macro collector where feasible:
   - Federal Reserve/FOMC references.
   - Treasury rates.
   - FRED/BLS configured API path if keys are available or public endpoint works.
   - SEC EDGAR company/filing collector for tracked symbols.
2. Add CN/HK official or durable collectors:
   - PBOC policy/liquidity headlines.
   - NBS release headlines/data.
   - SSE/SZSE/HKEX announcements where feasible.
3. Add fallback web/news collector with source dedupe and max item caps.
4. Add importance scoring and evidence IDs.

Exit criteria:

- Provider can produce macro/news/earnings evidence without the LLM doing first-pass discovery.
- Each evidence item has `id`, `source`, `captured_at`, and freshness.
- Tests cover source failure and dedupe.

### Phase 5: Cron Prompt Upgrade

1. Update `~/.miniclaw/cron/us-stock-pre-market.yaml`.
2. Update `~/.miniclaw/cron/cn-stock-pre-market.yaml`.
3. Replace single-analyst prompt with the role protocol and forecast editor contract.
4. Keep output focused on guidance, triggers, risk, and data quality.
5. Do not alter post-market or hourly pulse jobs in this phase.

Exit criteria:

- `pnpm cron:list` loads both jobs.
- `pnpm cron:test us-stock-pre-market` runs to Discord in a controlled test.
- `pnpm cron:test cn-stock-pre-market` runs to Discord in a controlled test.

### Phase 6: Forecast Persistence

1. Add `market_forecasts` tables after the provider output stabilizes.
2. Persist provider payload and final report text.
3. Extract structured forecast items from LLM output or require the LLM to produce a compact JSON block at the end.
4. Add read-only command or script to inspect recent forecasts.

Exit criteria:

- Each pre-market report has a durable forecast record.
- Stored forecast contains index probabilities and sector/risk calls.
- No private broker secrets are stored beyond existing redacted provider data.

### Phase 7: Post-Market Evaluation

1. Extend post-market jobs or add an evaluation provider.
2. Fetch close/open benchmark data.
3. Score index direction, sector calls, and risk triggers.
4. Write evaluation rows.
5. Add a short calibration note to post-market Discord output.

Exit criteria:

- Forecasts are scored after market close.
- Weekly review can show hit rate, Brier score, common miss reasons, and data quality correlation.

### Phase 8: Calibration Loop

1. Review one week of forecast/evaluation data.
2. Adjust scoring weights.
3. Tighten prompt rules where unsupported claims appear.
4. Add source-specific reliability weights.
5. Document known weak spots.

Exit criteria:

- Report quality improves through measured calibration, not prompt guesswork.
- Frequent false positives/false negatives are visible and actionable.

## Verification Plan

Static checks:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Unit tests:

```bash
pnpm vitest run src/providers/market-intel
pnpm vitest run src/providers/stock-portfolio src/providers/stock-pulse
```

Cron checks:

```bash
pnpm cron:list
pnpm cron:test us-stock-pre-market
pnpm cron:test cn-stock-pre-market
```

Quality gates before commit/push:

```bash
pnpm run quality:commit
pnpm run quality:push
```

Manual checks:

- Confirm Discord output lands in the correct US/CN stock channels.
- Confirm report starts with portfolio impact.
- Confirm analyst sections cite evidence IDs.
- Confirm no raw account IDs, token, cookie, validatekey, phone number, or broker session appears.
- Confirm closed-market days skip or label correctly.
- Confirm stale data warnings are visible.
- Confirm final forecast probabilities sum to 100%.

Fixture scenarios:

- Normal US trading day.
- Normal CN/HK trading day.
- US market holiday.
- China holiday but HK open.
- HK holiday but A-share open.
- US early close.
- Daylight saving transition week.
- Quote source partial outage.
- News source outage.
- Portfolio provider partial failure.
- All required data sources fail.
- Major macro event day.
- Major earnings-heavy day.

## Risks And Mitigations

### Risk: LLM Hallucinated Market Data

Mitigation:

- Require evidence IDs for factual claims.
- Put key numeric data in provider JSON.
- Explicitly mark unsupported statements as hypotheses.
- Penalize output that invents symbols, prices, or catalysts not present in provider output.

### Risk: Stale Or Delayed Data

Mitigation:

- Every data point needs `captured_at` and `stale`.
- Confidence is capped when critical data is stale.
- Data quality summary must appear in every report.

### Risk: Source Outage

Mitigation:

- Tiered source fallback.
- Fail closed for critical quote/calendar failure.
- Continue with warnings for non-critical news/earnings failure.

### Risk: Holiday Calendar Errors

Mitigation:

- Use explicit calendar fixtures.
- Keep market-specific calendar config in user-level provider config.
- Add tests for CN/HK divergence and US early closes.

### Risk: Private Data Leakage

Mitigation:

- Reuse existing redacted stock providers.
- Add redaction tests to `market-intel`.
- Never output raw source payloads directly.
- Keep exact asset summary limited to private channels only.

### Risk: Overconfident Forecasts

Mitigation:

- Probability caps based on evidence alignment.
- Forecast editor must include downside and invalidation triggers.
- Post-market Brier score tracks calibration.

### Risk: Too Slow Before Market Open

Mitigation:

- Trigger at 08:45 rather than 09:00.
- Run collectors concurrently with per-source timeouts.
- Cap news and filings item counts.
- Cache slow official references where appropriate.

## Rollback Plan

1. Keep current `stock-portfolio` provider unchanged.
2. Keep old cron prompt text in git history or a backup note.
3. If `market-intel` fails in production:
   - Change `pre_provider` back to `stock-portfolio`.
   - Change `pre_provider_config` back to `us-stock` or `cn-stock`.
   - Restore the simpler prompt.
4. If runtime is affected:
   - Disable only the two pre-market cron jobs.
   - Keep hourly pulse and post-market jobs running.
5. If a data source leaks sensitive data:
   - Disable the collector immediately.
   - Add redaction fixture.
   - Re-run provider tests before re-enabling.

## Documentation Sync

Docs to update during implementation:

- `docs/features/10-stock-portfolio-provider.md`
  - Only if `stock-portfolio` contract changes.
- `docs/features/11-stock-pulse-provider.md`
  - No expected change unless shared market utilities are extracted.
- New doc:
  - `docs/features/14-market-intel-provider.md`
- `docs/README.md`
  - Add a feature index entry after implementation.
- `CHANGELOG.md`
  - Add entry after provider and cron upgrade are verified.

User-level config docs should include:

- Example `~/.miniclaw/providers/market-intel/us-pre-market.yaml`.
- Example `~/.miniclaw/providers/market-intel/cn-pre-market.yaml`.
- Data source setup notes.
- Which sources require API keys.
- Which sources are public fallback only.

## Definition Of Done

The work is complete only when:

1. `market-intel` provider is implemented and registered.
2. US and CN/A/H configs exist locally and are not committed if they contain private configuration.
3. Both pre-market cron jobs use `market-intel`.
4. Provider output contains structured evidence, scores, data quality, and portfolio context.
5. Final Discord report uses the 5-role plus forecast editor protocol.
6. Critical claims cite evidence IDs.
7. Closed-market and stale-data paths are tested.
8. No broker/account/session secret leaks.
9. `pnpm cron:list`, provider tests, typecheck, and build pass.
10. At least one controlled `pnpm cron:test` run succeeds for each market.
11. Forecast persistence and post-market evaluation are either implemented or tracked as a follow-up plan with explicit status.

## Execution Notes

Initial planning evidence collected on 2026-05-10:

- Existing cron system already supports `pre_provider`.
- Existing stock jobs already cover US/CN pre-market, post-market, intraday pulse, and daily summary.
- Existing `stock-portfolio` is the right portfolio context base.
- Existing `stock-pulse` is the right pattern for deterministic provider-side analysis followed by LLM explanation.
- Current pre-market reports should be upgraded rather than duplicated.
- Data source validation completed before provider implementation:
  - Use SEC, BLS, Treasury, Federal Reserve, Cboe history, PBOC, NBS, SSE, SZSE, HKEX, and Futu OpenD as primary/default sources where their metric coverage matches.
  - Use Futu OpenD for US/HK quotes on this machine; do not use it as default for CN-A quotes until A-share quote permissions are available.
  - Treat FRED API, Polygon, and Tushare as optional because required credentials are not configured locally.
  - Treat Yahoo chart and Eastmoney public endpoints as fallback-only because they are unofficial/undocumented.
  - Remove Stooq and AKShare from the default pre-market source plan.

Material deviations from this plan and final verification evidence should be appended here during implementation.
