import type { PreProviderResult, PreProviderRunArgs } from "../types.js";

export type StockPulseMarketScope = "us" | "cn";
export type StockPulseMarket = "us" | "cn-a" | "hk";
export type StockPulseInstrumentType = "stock" | "etf" | "leveraged_etf";
export type StockPulseSeverity = "notice" | "alert" | "urgent";

export interface StockPulseTimeWindow {
  timezone: string;
  start: string;
  end: string;
}

export interface StockPulseMarketSession {
  start: string;
  end: string;
}

export interface StockPulseMarketConfig {
  timezone: string;
  sessions: StockPulseMarketSession[];
  holidays: string[];
}

export interface StockPulseSymbolConfig {
  symbol: string;
  name?: string;
  market?: StockPulseMarket;
  yahoo_symbol?: string;
  instrument_type?: StockPulseInstrumentType;
  source?: string;
}

export interface StockPulseUniverseSourceConfig {
  type: "yahoo_screener" | "eastmoney_clist";
  name: string;
  market: StockPulseMarket;
  enabled: boolean;
  limit: number;
  scr_id?: string;
  fs?: string;
}

export interface StockPulseUniverseConfig {
  enabled: boolean;
  include_portfolio: boolean;
  include_watchlist: boolean;
  include_sources: boolean;
  max_symbols: number;
  symbols: StockPulseSymbolConfig[];
  sources: StockPulseUniverseSourceConfig[];
}

export interface StockPulseQuoteConfig {
  provider: "yahoo";
  interval: "5m" | "15m";
  range: "5d" | "1mo" | "60d";
  include_prepost: boolean;
  timeout_ms: number;
  concurrency: number;
}

export interface StockPulseThresholdRule {
  hour_abs_pct: number;
  day_abs_pct: number;
  bar_abs_pct: number;
  bar_sigma_multiplier: number;
  abnormal_bar_count: number;
  same_direction_bars: number;
  z_score: number;
  urgent_z_score: number;
}

export interface StockPulseThresholdConfig {
  stock: StockPulseThresholdRule;
  etf: StockPulseThresholdRule;
  leveraged_etf: StockPulseThresholdRule;
}

export interface StockPulseProviderConfig {
  market_scope: StockPulseMarketScope;
  portfolio_provider_config?: string;
  active_window: StockPulseTimeWindow;
  markets: Partial<Record<StockPulseMarket, StockPulseMarketConfig>>;
  universe: StockPulseUniverseConfig;
  quote: StockPulseQuoteConfig;
  thresholds: StockPulseThresholdConfig;
}

export interface StockPulseSymbol {
  symbol: string;
  name?: string;
  market: StockPulseMarket;
  yahoo_symbol: string;
  instrument_type: StockPulseInstrumentType;
  sources: string[];
  portfolio?: StockPulsePortfolioPnl;
}

export interface StockPulseUniverseSymbol {
  symbol: string;
  name?: string;
  market: StockPulseMarket;
  yahoo_symbol?: string;
  instrument_type?: StockPulseInstrumentType;
  source: string;
}

export interface StockPulseQuoteBar {
  timestamp: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
}

export interface StockPulseQuoteSeries {
  symbol: string;
  provider_symbol: string;
  market: StockPulseMarket;
  currency?: string;
  previous_close?: number;
  bars: StockPulseQuoteBar[];
}

export interface StockPulseQuoteClient {
  getBars(symbol: StockPulseSymbol, config: StockPulseQuoteConfig): Promise<StockPulseQuoteSeries>;
  getUniverseSymbols?(source: StockPulseUniverseSourceConfig): Promise<StockPulseUniverseSymbol[]>;
}

export interface StockPulseBaseline {
  bar_return_std_pct: number;
  hour_return_std_pct: number;
  abnormal_bar_count_p95: number;
  sample_bar_count: number;
  sample_hour_window_count: number;
}

export interface StockPulsePortfolioPnl {
  source_label?: string;
  source_currency?: string;
  fx_rate_to_cny?: number;
  daily_pnl_cny?: number;
  unrealized_pnl_cny?: number;
  realized_pnl_cny?: number;
  pnl_ratio?: number;
}

export interface StockPulsePositionSnapshot {
  symbol: string;
  yahoo_symbol: string;
  name?: string;
  market: StockPulseMarket;
  instrument_type: StockPulseInstrumentType;
  sources: string[];
  latest_price: number;
  price_currency?: string;
  latest_at: string;
  previous_close?: number;
  hour_return_pct?: number;
  day_return_pct?: number;
  portfolio?: StockPulsePortfolioPnl;
}

export interface StockPulsePositionGroups {
  profitable: StockPulsePositionSnapshot[];
  losing: StockPulsePositionSnapshot[];
  flat_or_unknown: StockPulsePositionSnapshot[];
}

export interface StockPulseAlert {
  symbol: string;
  yahoo_symbol: string;
  name?: string;
  market: StockPulseMarket;
  instrument_type: StockPulseInstrumentType;
  sources: string[];
  latest_price: number;
  latest_at: string;
  previous_close?: number;
  hour_return_pct?: number;
  day_return_pct?: number;
  z_score?: number;
  abnormal_bar_count: number;
  abnormal_bar_count_expected_p95: number;
  same_direction_bars: number;
  direction: "up" | "down" | "mixed";
  severity: StockPulseSeverity;
  triggers: string[];
  baseline: StockPulseBaseline;
}

export interface StockPulseQuoteFailure {
  symbol: string;
  yahoo_symbol: string;
  name?: string;
  market: StockPulseMarket;
  sources: string[];
  error: string;
}

export interface StockPulsePayload {
  generated_at: string;
  source: "stock-pulse";
  profile: string;
  market_scope: StockPulseMarketScope;
  run_context: {
    active_window_ok: boolean;
    open_markets: StockPulseMarket[];
    skipped: boolean;
    skip_reason?: string;
  };
  universe: {
    configured_symbols: number;
    portfolio_symbols: number;
    universe_source_symbols: number;
    scanned_symbols: number;
    failed_symbols: number;
  };
  positions: StockPulsePositionSnapshot[];
  position_groups: StockPulsePositionGroups;
  alerts: StockPulseAlert[];
  failures: StockPulseQuoteFailure[];
  warnings: string[];
  usage_notes: string[];
}

export type StockPulsePortfolioRunner = (args: PreProviderRunArgs) => Promise<PreProviderResult>;

export interface StockPulseProviderRunResult {
  payload: StockPulsePayload;
  commits: Array<() => Promise<void>>;
}

export interface StockPulseDryRunSummary {
  generated_at: string;
  source: "stock-pulse";
  profile: string;
  market_scope: StockPulseMarketScope;
  run_context: StockPulsePayload["run_context"];
  universe: StockPulsePayload["universe"];
  position_count: number;
  alert_count: number;
  failure_count: number;
  warning_count: number;
}
