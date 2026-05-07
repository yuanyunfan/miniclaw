export type FutuRedactionLevel = "summary" | "exact";

export interface FutuStockProfileConfig {
  opend_host: string;
  opend_port: number;
  account_alias: string;
  currency: string;
  redaction: FutuRedactionLevel;
  snapshot_dir: string;
  python_bin: string;
  trd_market: string;
  security_firm: string;
  acc_index?: number;
  acc_id?: string;
  allow_non_local_opend: boolean;
  show_total_assets: boolean;
}

export interface FutuStockConfig {
  profiles: Record<string, FutuStockProfileConfig>;
}

export interface FutuToolRequest {
  profile?: string;
  account_alias?: string;
  market_session?: string;
  redaction?: FutuRedactionLevel;
  top_positions_limit?: number;
}

export interface FutuHealthCheck {
  ok: boolean;
  opend: {
    ok: boolean;
    host: string;
    port: number;
    error?: string;
  };
  python: {
    ok: boolean;
    bin: string;
    futu_api_available: boolean;
    error?: string;
  };
}

export interface FutuRawBrokerData {
  captured_at: string;
  account?: Record<string, unknown> | null;
  positions: Array<Record<string, unknown>>;
  deals?: Array<Record<string, unknown>>;
  cash_flows?: Array<Record<string, unknown>>;
}

export interface FutuPositionSummary {
  code: string;
  name: string;
  currency: string;
  quantity?: number;
  market_value?: number;
  daily_pnl?: number;
  pnl_value?: number;
  pnl_ratio?: number;
  unrealized_pnl?: number;
  realized_pnl?: number;
}

export interface FutuAccountSnapshot {
  broker: "futu";
  account_alias: string;
  captured_at: string;
  currency: string;
  market_session: string;
  total_assets?: number;
  market_value?: number;
  cash?: number;
  daily_pnl?: number;
  daily_pnl_pct?: number;
  realized_pnl?: number;
  unrealized_pnl?: number;
  positions: FutuPositionSummary[];
  warnings: string[];
}

export interface FutuStockClient {
  healthCheck(profile: FutuStockProfileConfig): Promise<FutuHealthCheck>;
  getRawBrokerData(profile: FutuStockProfileConfig): Promise<FutuRawBrokerData>;
}
