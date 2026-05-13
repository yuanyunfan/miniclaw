import type {
  EastmoneyJywgSession,
  EastmoneyJywgAccountSnapshot,
  EastmoneyJywgPositionSummary,
  EastmoneyJywgRedactionLevel,
} from "../../mcp/eastmoney-jywg/types.js";
import type { AssetAllocationSummary } from "../asset-allocation.js";

export type EastmoneyJywgPositiveMarketValueGapPolicy = "unclassified" | "cash_like";

export interface EastmoneyJywgAssetGapPolicyConfig {
  positive_market_value_gap: EastmoneyJywgPositiveMarketValueGapPolicy;
  label?: string;
}

export interface EastmoneyJywgProviderConfig {
  profile: string;
  account_alias?: string;
  market_session?: string;
  market_session_by_job: Record<string, string>;
  redaction: EastmoneyJywgRedactionLevel;
  top_positions_limit: number;
  include_account_snapshot: boolean;
  include_daily_report: boolean;
  include_positions_summary: boolean;
  include_asset_allocation: boolean;
  asset_gap_policy: EastmoneyJywgAssetGapPolicyConfig;
}

export interface EastmoneyJywgProviderTopPosition {
  code: string;
  name: string;
  currency: string;
  instrument_type?: "stock" | "etf";
  daily_pnl?: number;
  daily_pnl_ratio?: number;
  floating_pnl?: number;
  pnl_ratio?: number;
}

export interface EastmoneyJywgProviderPnlSummary {
  currency: string;
  gross_profit: number;
  gross_loss: number;
  net_pnl: number;
  winners_count: number;
  losers_count: number;
  flat_count: number;
  positions_with_pnl_count: number;
  pnl_source: "positions_daily_pnl" | "aggregate_pnl_fallback" | "unavailable";
}

export interface EastmoneyJywgProviderFormatOptions {
  generatedAt: Date;
  profileName: string;
  marketSession: string;
  redaction: EastmoneyJywgRedactionLevel;
  topPositionsLimit: number;
  includeAccountSnapshot: boolean;
  includeDailyReport: boolean;
  includePositionsSummary: boolean;
  includeAssetAllocation: boolean;
  assetGapPolicy: EastmoneyJywgAssetGapPolicyConfig;
}

export interface EastmoneyJywgProviderPayload {
  generated_at: string;
  source: "eastmoney-jywg-readonly";
  profile: string;
  account_alias: string;
  market_session: string;
  redaction: EastmoneyJywgRedactionLevel;
  report?: string;
  snapshot?: Record<string, unknown>;
  positions_summary?: {
    positions_count: number;
    pnl_summary: EastmoneyJywgProviderPnlSummary;
    top_positions: EastmoneyJywgProviderTopPosition[];
    top_gainers: EastmoneyJywgProviderTopPosition[];
    top_losers: EastmoneyJywgProviderTopPosition[];
  };
  asset_summary?: AssetAllocationSummary;
  warnings: string[];
  usage_notes: string[];
}

export interface EastmoneyJywgProviderRunResult {
  payload: EastmoneyJywgProviderPayload;
  session_secret_path: string;
  updated_session: EastmoneyJywgSession;
}

export interface EastmoneyJywgDryRunSummary {
  generated_at: string;
  source: "eastmoney-jywg-readonly";
  profile: string;
  market_session: string;
  redaction: EastmoneyJywgRedactionLevel;
  account_alias_present: boolean;
  report_included: boolean;
  snapshot_included: boolean;
  positions_summary_included: boolean;
  asset_summary_included: boolean;
  positions_count: number;
  top_positions_count: number;
  warning_count: number;
}

export type EastmoneyJywgProviderSnapshotInput = EastmoneyJywgAccountSnapshot;
export type EastmoneyJywgProviderPositionInput = EastmoneyJywgPositionSummary;
