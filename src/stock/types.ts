export type StockMarketScope = "all" | "us" | "cn" | "cn-a" | "hk" | "cross-market";
export type StockMarket = "us" | "cn-a" | "hk";
export type StockInstrumentType = "stock" | "etf" | "leveraged_etf" | "index" | "fund" | "cash" | "unknown";
export type StockSourceTier = "official" | "broker_readonly" | "public_market_data" | "fallback" | "derived";
export type StockDataQualityStatus = "ok" | "partial" | "blocked" | "empty";
export type StockSignalSeverity = "info" | "notice" | "alert" | "urgent";

export interface StockSymbolRef {
  symbol: string;
  provider_symbol?: string;
  name?: string;
  market: StockMarket;
  instrument_type?: StockInstrumentType;
  currency?: string;
  sources?: string[];
}

export interface StockQuoteBar {
  timestamp: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
}

export interface StockQuoteSnapshot {
  symbol: string;
  provider_symbol: string;
  market?: StockMarket;
  source: string;
  source_tier: StockSourceTier;
  captured_at: string;
  latest_at: string;
  latest_price: number;
  previous_close?: number;
  change_pct?: number;
  currency?: string;
  bars?: StockQuoteBar[];
}

export interface StockPortfolioPositionSnapshot {
  provider: string;
  config: string;
  label?: string;
  code: string;
  name?: string;
  market?: StockMarket;
  instrument_type?: StockInstrumentType;
  currency?: string;
  market_value?: number;
  daily_pnl?: number;
  unrealized_pnl?: number;
  pnl_ratio?: number;
}

export interface StockPortfolioSnapshot {
  generated_at: string;
  profile: string;
  market_scope: StockMarketScope;
  base_currency?: string;
  positions: StockPortfolioPositionSnapshot[];
  warnings: string[];
  source_payload?: unknown;
}

export interface StockMarketEvidence {
  id: string;
  category: "calendar" | "portfolio" | "quote" | "macro" | "news" | "earnings" | "filing" | "sector" | "risk" | "memory" | "score";
  source: string;
  source_tier: StockSourceTier;
  captured_at: string;
  title?: string;
  summary: string;
  published_at?: string;
  importance?: "low" | "medium" | "high";
  freshness?: "fresh" | "stale" | "unknown";
  freshness_minutes?: number;
  url?: string;
  symbols?: string[];
  sectors?: string[];
}

export interface StockMarketMemoryItem {
  stable_key: string;
  topic: string;
  fact: string;
  market_impact: string;
  affected_markets: string[];
  horizon: string;
  status: "active" | "stale" | "resolved";
  confidence?: number;
  evidence_ids: string[];
  source_urls: string[];
  first_seen_at?: string;
  last_updated_at?: string;
  expires_at?: string;
}

export interface StockMarketMemorySnapshot {
  market_scope: StockMarketScope;
  trade_date: string;
  generated_at: string;
  digest_text: string;
  active_items: StockMarketMemoryItem[];
  data_quality?: unknown;
}

export interface StockSignal {
  id: string;
  kind: string;
  target: string;
  severity: StockSignalSeverity;
  direction?: "bullish" | "bearish" | "neutral" | "mixed" | "up" | "down";
  confidence?: number;
  evidence_ids: string[];
  rationale: string;
  invalidation?: string;
  metrics?: Record<string, number | string | boolean | undefined>;
}

export interface StockReportContext {
  generated_at: string;
  source: string;
  profile: string;
  market_scope?: StockMarketScope;
  data_quality?: {
    status: StockDataQualityStatus;
    warnings: string[];
  };
  evidence?: StockMarketEvidence[];
  signals?: StockSignal[];
  market_memory?: StockMarketMemorySnapshot[];
  usage_notes?: string[];
}
