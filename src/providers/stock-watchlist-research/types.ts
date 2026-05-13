import type { MarketIntelPayload } from "../market-intel/types.js";
import type {
  StockPulseInstrumentType,
  StockPulseMarket,
  StockPulseMarketScope,
  StockPulsePositionSnapshot,
  StockPulseSymbol,
} from "../stock-pulse/types.js";

export type StockWatchlistResearchRunType = "pre_market" | "daily";

export interface StockWatchlistResearchQuoteConfig {
  interval: "5m" | "15m";
  range: "5d" | "1mo" | "60d";
  include_prepost: boolean;
  timeout_ms: number;
  concurrency: number;
}

export interface StockWatchlistResearchConfig {
  market_scope: StockPulseMarketScope;
  run_type: StockWatchlistResearchRunType;
  timezone: string;
  stock_pulse_config: string;
  market_intel_config?: string;
  max_symbols: number;
  quote: StockWatchlistResearchQuoteConfig;
  research: {
    enabled: boolean;
    news_count_per_symbol: number;
    timeout_ms: number;
    concurrency: number;
  };
}

export interface StockWatchlistResearchProfile {
  symbol: string;
  provider_symbol: string;
  quote_type?: string;
  exchange?: string;
  sector?: string;
  industry?: string;
  long_name?: string;
  short_name?: string;
  source: string;
}

export interface StockWatchlistFinancialPoint {
  type: string;
  as_of_date?: string;
  period_type?: string;
  raw?: number;
  fmt?: string;
}

export interface StockWatchlistFinancials {
  source: string;
  status: "ok" | "partial" | "failed";
  latest_points: StockWatchlistFinancialPoint[];
  error?: string;
}

export interface StockWatchlistNewsItem {
  title: string;
  publisher?: string;
  published_at?: string;
  url?: string;
  related_tickers: string[];
}

export interface StockWatchlistResearchSymbol {
  symbol: string;
  yahoo_symbol: string;
  name?: string;
  market: StockPulseMarket;
  instrument_type: StockPulseInstrumentType;
  sources: string[];
  evidence_ids: string[];
  quote?: StockPulsePositionSnapshot;
  quote_error?: string;
  profile?: StockWatchlistResearchProfile;
  profile_error?: string;
  financials?: StockWatchlistFinancials;
  news: StockWatchlistNewsItem[];
  news_error?: string;
}

export type StockWatchlistPortfolioFilterStatus =
  | "applied"
  | "not_run"
  | "not_configured"
  | "failed"
  | "incomplete";

export interface StockWatchlistPortfolioFilterSummary {
  status: StockWatchlistPortfolioFilterStatus;
  stock_portfolio_config?: string;
  held_symbols: number;
  excluded_symbols: number;
}

export interface StockWatchlistResearchSourceSummary {
  stock_pulse_config: string;
  enabled_broker_sources: number;
  fetched_symbols: number;
  scanned_symbols: number;
  raw_watchlist_symbols: number;
  portfolio_filter: StockWatchlistPortfolioFilterSummary;
  warnings: string[];
}

export interface StockWatchlistResearchPayload {
  generated_at: string;
  source: "stock-watchlist-research";
  profile: string;
  market_scope: StockPulseMarketScope;
  run_type: StockWatchlistResearchRunType;
  run_context: {
    job_name: string;
    channel_id: string;
    timezone: string;
    watchlist_only: true;
    skipped: boolean;
    skip_reason?: string;
  };
  watchlist_source: StockWatchlistResearchSourceSummary;
  symbols: StockWatchlistResearchSymbol[];
  market_context?: MarketIntelPayload;
  evidence: Array<{
    id: string;
    category: "quote" | "profile" | "financials" | "news";
    symbol: string;
    summary: string;
    source: string;
    url?: string;
    published_at?: string;
  }>;
  warnings: string[];
  usage_notes: string[];
}

export interface StockWatchlistResearchClient {
  getProfile(symbol: StockPulseSymbol, timeoutMs: number): Promise<StockWatchlistResearchProfile | undefined>;
  getFinancials(symbol: StockPulseSymbol, timeoutMs: number): Promise<StockWatchlistFinancials>;
  getNews(symbol: StockPulseSymbol, count: number, timeoutMs: number): Promise<StockWatchlistNewsItem[]>;
}
