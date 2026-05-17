import type { StockProviderResult, StockProviderRunArgs } from "../types.js";
import type { MarketIntelMarketScope } from "../data/market-intel-types.js";

export interface MarketForecastBenchmarkConfig {
  symbol: string;
  provider_symbol?: string;
  label?: string;
}

export interface MarketForecastEvaluationProviderConfig {
  market_scope: MarketIntelMarketScope;
  timezone: string;
  forecast_session: "pre_market";
  portfolio_provider_config?: string;
  direction_threshold_pct: number;
  benchmark_symbols: MarketForecastBenchmarkConfig[];
}

export interface MarketForecastEvaluationQuoteInput {
  symbol: string;
  provider_symbol: string;
  latest_at: string;
  latest_price: number;
  previous_close?: number;
  currency?: string;
}

export interface MarketForecastEvaluationQuoteClient {
  source: string;
  source_tier: string;
  getSnapshot(request: MarketForecastBenchmarkConfig & { provider_symbol: string }): Promise<MarketForecastEvaluationQuoteInput>;
}

export type MarketForecastEvaluationPortfolioRunner = (args: StockProviderRunArgs) => Promise<StockProviderResult>;

export type MarketForecastOutcomeBucket = "up" | "range_bound" | "down" | "unknown";
export type MarketForecastEvaluationItemType = "index_direction" | "sector_opportunity" | "risk_alert";

export interface MarketForecastProbabilityGroup {
  target: string;
  source: string;
  up: number;
  range_bound: number;
  down: number;
  confidence?: number;
}

export interface MarketForecastBenchmarkResult {
  symbol: string;
  provider_symbol: string;
  label?: string;
  latest_at?: string;
  latest_price?: number;
  previous_close?: number;
  change_pct?: number;
  outcome: MarketForecastOutcomeBucket;
  source: string;
  error?: string;
}

export interface MarketForecastEvaluationScore {
  item_type: MarketForecastEvaluationItemType;
  target: string;
  benchmark_symbol: string;
  predicted: MarketForecastOutcomeBucket;
  actual: MarketForecastOutcomeBucket;
  hit: boolean;
  brier_score?: number;
  details?: string;
  probabilities: {
    up: number;
    range_bound: number;
    down: number;
  };
}
