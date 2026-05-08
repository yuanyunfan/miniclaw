import type { FutuAccountSnapshot, FutuPositionSummary, FutuRedactionLevel } from "../../mcp/futu-stock/types.js";

export interface FutuStockProviderConfig {
  profile: string;
  account_alias?: string;
  market_session?: string;
  market_session_by_job: Record<string, string>;
  redaction: FutuRedactionLevel;
  top_positions_limit: number;
  include_account_snapshot: boolean;
  include_daily_report: boolean;
  include_positions_summary: boolean;
}

export interface FutuStockProviderTopPosition {
  code: string;
  name: string;
  currency: string;
  instrument_type?: "stock" | "etf";
  daily_pnl?: number;
  pnl_value?: number;
  pnl_ratio?: number;
  unrealized_pnl?: number;
  realized_pnl?: number;
}

export interface FutuStockProviderPnlSummary {
  currency: string;
  gross_profit: number;
  gross_loss: number;
  net_pnl: number;
  winners_count: number;
  losers_count: number;
  flat_count: number;
  positions_with_pnl_count: number;
}

export interface FutuStockProviderFormatOptions {
  generatedAt: Date;
  profileName: string;
  marketSession: string;
  redaction: FutuRedactionLevel;
  topPositionsLimit: number;
  includeAccountSnapshot: boolean;
  includeDailyReport: boolean;
  includePositionsSummary: boolean;
}

export interface FutuStockProviderPayload {
  generated_at: string;
  source: "futu-opend-readonly";
  profile: string;
  account_alias: string;
  market_session: string;
  redaction: FutuRedactionLevel;
  report?: string;
  snapshot?: Record<string, unknown>;
  positions_summary?: {
    positions_count: number;
    pnl_summary: FutuStockProviderPnlSummary;
    top_positions: FutuStockProviderTopPosition[];
    top_gainers: FutuStockProviderTopPosition[];
    top_losers: FutuStockProviderTopPosition[];
  };
  warnings: string[];
  usage_notes: string[];
}

export type FutuStockProviderSnapshotInput = FutuAccountSnapshot;
export type FutuStockProviderPositionInput = FutuPositionSummary;
