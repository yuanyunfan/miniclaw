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
  daily_pnl?: number;
  pnl_value?: number;
  pnl_ratio?: number;
  unrealized_pnl?: number;
  realized_pnl?: number;
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
    top_positions: FutuStockProviderTopPosition[];
  };
  warnings: string[];
  usage_notes: string[];
}

export type FutuStockProviderSnapshotInput = FutuAccountSnapshot;
export type FutuStockProviderPositionInput = FutuPositionSummary;
