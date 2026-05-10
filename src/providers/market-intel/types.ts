import type { PreProviderResult, PreProviderRunArgs } from "../types.js";
import type { StockPortfolioAssetSummary, StockPortfolioCnySummary } from "../stock-portfolio/types.js";
import type { MarketIntelScoringCalibrationConfig } from "./calibration.js";

export type MarketIntelMarketScope = "us" | "cn";
export type MarketIntelMarket = "us" | "cn-a" | "hk";
export type MarketIntelSession = "pre_market";
export type MarketIntelCalendarProvider = "static" | "static_plus_remote";
export type MarketIntelCalendarStatus = "closed" | "pre_market" | "open" | "break" | "after_close" | "partial" | "mixed";
export type MarketIntelLocalMarketStatus = "closed" | "pre_market" | "open" | "break" | "after_close";
export type MarketIntelDataQualityStatus = "ok" | "partial" | "blocked";
export type MarketIntelSourceTier = "official" | "local_readonly" | "optional" | "fallback" | "placeholder";
export type MarketIntelSourceStatus = "ok" | "partial" | "missing_config" | "failed" | "not_implemented" | "skipped";
export type MarketIntelDirection = "bullish" | "bearish" | "neutral" | "mixed" | "insufficient_data";
export type MarketIntelSnapshotSectionStatus = "ok" | "partial" | "empty" | "not_implemented";
export type MarketIntelQuoteWatchBucket = "indices" | "sectors" | "macro" | "cross_market" | "symbols";
export type MarketIntelEvidenceSectionStatus = "ok" | "partial" | "empty" | "skipped" | "not_implemented";
export type MarketIntelEvidenceImportance = "low" | "medium" | "high";
export type MarketIntelEvidenceFreshness = "fresh" | "stale" | "unknown";

export interface MarketIntelTimeWindow {
  start: string;
  end: string;
}

export interface MarketIntelMarketConfig {
  timezone: string;
  sessions: MarketIntelTimeWindow[];
  holidays: string[];
  early_closes: MarketIntelEarlyClose[];
}

export interface MarketIntelCalendarConfig {
  provider: MarketIntelCalendarProvider;
  holidays: string[];
  early_closes: MarketIntelEarlyClose[];
  fail_on_unknown_trade_date: boolean;
  skip_closed_market: boolean;
}

export interface MarketIntelEarlyClose {
  date: string;
  close: string;
}

export interface MarketIntelQuoteSourcesConfig {
  us_primary?: string;
  hk_primary?: string;
  cn_a_primary?: string;
  fallback: string[];
  optional_paid: string[];
}

export interface MarketIntelMacroSourcesConfig {
  federal_reserve?: string;
  treasury?: string;
  bls?: string;
  fred?: string;
  pboc?: string;
  nbs?: string;
}

export interface MarketIntelNewsSourcesConfig {
  provider: string;
  max_items: number;
}

export interface MarketIntelEarningsSourcesConfig {
  provider: string;
  max_items: number;
}

export interface MarketIntelSectorSourcesConfig {
  provider: string;
}

export interface MarketIntelSourcesConfig {
  quotes: MarketIntelQuoteSourcesConfig;
  macro: MarketIntelMacroSourcesConfig;
  news: MarketIntelNewsSourcesConfig;
  earnings: MarketIntelEarningsSourcesConfig;
  sectors: MarketIntelSectorSourcesConfig;
}

export interface MarketIntelWatchlistsConfig {
  indices: string[];
  sectors: string[];
  macro: string[];
  cross_market: string[];
  symbols: string[];
}

export interface MarketIntelQualityConfig {
  max_stale_minutes: {
    quote: number;
    news: number;
    macro: number;
  };
  fail_if_all_quotes_fail: boolean;
  allow_partial_news: boolean;
}

export interface MarketIntelProviderConfig {
  market_scope: MarketIntelMarketScope;
  session: MarketIntelSession;
  timezone: string;
  portfolio_provider_config?: string;
  calendar: MarketIntelCalendarConfig;
  markets: Partial<Record<MarketIntelMarket, MarketIntelMarketConfig>>;
  sources: MarketIntelSourcesConfig;
  watchlists: MarketIntelWatchlistsConfig;
  quality: MarketIntelQualityConfig;
}

export interface MarketIntelCalendarMarketSnapshot {
  market: MarketIntelMarket;
  timezone: string;
  trade_date: string;
  status: MarketIntelLocalMarketStatus;
  reason?: string;
  current_time: string;
  sessions: MarketIntelTimeWindow[];
  early_close?: string;
}

export interface MarketIntelCalendarSnapshot {
  status: MarketIntelCalendarStatus;
  trade_date: string;
  timezone: string;
  open_markets: MarketIntelMarket[];
  tradable_markets: MarketIntelMarket[];
  closed_markets: MarketIntelMarket[];
  markets: MarketIntelCalendarMarketSnapshot[];
}

export interface MarketIntelEvidenceItem {
  id: string;
  category: "calendar" | "portfolio" | "quote" | "macro" | "news" | "earnings" | "filing" | "sector" | "risk" | "score";
  source: string;
  source_tier: MarketIntelSourceTier;
  captured_at: string;
  title?: string;
  summary: string;
  published_at?: string;
  importance?: MarketIntelEvidenceImportance;
  freshness?: MarketIntelEvidenceFreshness;
  freshness_minutes?: number;
  url?: string;
  symbols?: string[];
  sectors?: string[];
}

export interface MarketIntelDataQualitySource {
  id: string;
  collector: string;
  source: string;
  tier: MarketIntelSourceTier;
  status: MarketIntelSourceStatus;
  message?: string;
}

export interface MarketIntelDataQuality {
  status: MarketIntelDataQualityStatus;
  warnings: string[];
  sources: MarketIntelDataQualitySource[];
}

export interface MarketIntelPlaceholderSection {
  status: "not_implemented";
  items: unknown[];
  notes: string[];
}

export interface MarketIntelEvidenceSection {
  status: MarketIntelEvidenceSectionStatus;
  items: MarketIntelEvidenceItem[];
  notes: string[];
}

export interface MarketIntelEvidenceCollection {
  macro_policy: MarketIntelEvidenceSection;
  news: MarketIntelEvidenceSection;
  earnings: MarketIntelEvidenceSection;
  filings: MarketIntelEvidenceSection;
  risks: MarketIntelEvidenceSection;
  evidence: MarketIntelEvidenceItem[];
  data_quality_sources: MarketIntelDataQualitySource[];
  warnings: string[];
}

export interface MarketIntelSnapshotItem {
  symbol: string;
  provider_symbol: string;
  bucket: MarketIntelQuoteWatchBucket;
  source: string;
  source_tier: MarketIntelSourceTier;
  captured_at: string;
  latest_at: string;
  latest_price: number;
  previous_close?: number;
  change_pct?: number;
  currency?: string;
  freshness_minutes?: number;
  stale: boolean;
}

export interface MarketIntelSnapshotFailure {
  symbol: string;
  provider_symbol?: string;
  bucket: MarketIntelQuoteWatchBucket;
  source: string;
  source_tier: MarketIntelSourceTier;
  error: string;
  skipped: boolean;
}

export interface MarketIntelSnapshotSection {
  status: MarketIntelSnapshotSectionStatus;
  items: MarketIntelSnapshotItem[];
  failures: MarketIntelSnapshotFailure[];
  notes: string[];
}

export interface MarketIntelMarketSnapshot {
  indices: MarketIntelSnapshotSection;
  sectors: MarketIntelSnapshotSection;
  macro: MarketIntelSnapshotSection;
  cross_market: MarketIntelSnapshotSection;
  symbols: MarketIntelSnapshotSection;
}

export interface MarketIntelPortfolioSourceSummary {
  provider: string;
  config: string;
  label?: string;
  status: "ok" | "error";
  error?: string;
}

export interface MarketIntelPortfolioContext {
  status: "not_configured" | "ok" | "partial";
  profile?: string;
  ok_count: number;
  failed_count: number;
  cny_summary?: StockPortfolioCnySummary;
  asset_summary?: StockPortfolioAssetSummary;
  sources: MarketIntelPortfolioSourceSummary[];
  warnings: string[];
  usage_notes: string[];
  notes: string[];
}

export interface MarketIntelScore {
  target: string;
  direction: MarketIntelDirection;
  probability?: number;
  confidence: number;
  evidence_ids: string[];
  rationale: string;
  invalidation?: string;
}

export interface MarketIntelScores {
  index_direction: MarketIntelScore;
  sector_opportunities: MarketIntelScore[];
  risk_level: MarketIntelScore;
}

export interface MarketIntelRoleProtocol {
  roles: string[];
  editor: string;
  required_fields: string[];
}

export interface MarketIntelPayload {
  generated_at: string;
  source: "market-intel";
  profile: string;
  market_scope: MarketIntelMarketScope;
  session: MarketIntelSession;
  run_context: {
    job_name: string;
    channel_id: string;
    timezone: string;
    calendar_status: MarketIntelCalendarStatus;
    trade_date: string;
    skipped: boolean;
    skip_reason?: string;
    open_markets: MarketIntelMarket[];
    tradable_markets: MarketIntelMarket[];
    closed_markets: MarketIntelMarket[];
  };
  calendar: MarketIntelCalendarSnapshot;
  data_quality: MarketIntelDataQuality;
  portfolio_context: MarketIntelPortfolioContext;
  market_snapshot: MarketIntelMarketSnapshot;
  macro_policy: MarketIntelEvidenceSection;
  news: MarketIntelEvidenceSection;
  earnings: MarketIntelEvidenceSection;
  filings: MarketIntelEvidenceSection;
  risks: MarketIntelEvidenceSection;
  scores: MarketIntelScores;
  calibration?: MarketIntelScoringCalibrationConfig;
  evidence: MarketIntelEvidenceItem[];
  role_protocol: MarketIntelRoleProtocol;
  usage_notes: string[];
}

export type MarketIntelPortfolioRunner = (args: PreProviderRunArgs) => Promise<PreProviderResult>;
export type MarketIntelEvidenceCollector = (params: {
  args: PreProviderRunArgs;
  config: MarketIntelProviderConfig;
}) => Promise<MarketIntelEvidenceCollection>;

export interface MarketIntelQuoteRequest {
  symbol: string;
  provider_symbol: string;
  bucket: MarketIntelQuoteWatchBucket;
}

export interface MarketIntelQuoteSnapshotInput {
  symbol: string;
  provider_symbol: string;
  latest_at: string;
  latest_price: number;
  previous_close?: number;
  currency?: string;
}

export interface MarketIntelQuoteClient {
  source: string;
  source_tier: MarketIntelSourceTier;
  getSnapshot(request: MarketIntelQuoteRequest): Promise<MarketIntelQuoteSnapshotInput>;
}
