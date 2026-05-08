import type {
  EastmoneyJywgAccountSnapshot,
  EastmoneyJywgPositionSummary,
  EastmoneyJywgRedactionLevel,
} from "../../mcp/eastmoney-jywg/types.js";

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
}

export interface EastmoneyJywgProviderTopPosition {
  code: string;
  name: string;
  currency: string;
  daily_pnl?: number;
  floating_pnl?: number;
  pnl_ratio?: number;
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
    top_positions: EastmoneyJywgProviderTopPosition[];
  };
  warnings: string[];
  usage_notes: string[];
}

export type EastmoneyJywgProviderSnapshotInput = EastmoneyJywgAccountSnapshot;
export type EastmoneyJywgProviderPositionInput = EastmoneyJywgPositionSummary;
