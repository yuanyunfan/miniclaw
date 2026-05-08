export type EastmoneyJywgRedactionLevel = "summary" | "exact";

export interface EastmoneyJywgCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  secure?: boolean;
  httpOnly?: boolean;
}

export interface EastmoneyJywgSession {
  version: 1;
  profile?: string;
  host: "jywg.18.cn";
  created_at?: string;
  last_verified_at?: string;
  expires_at_hint?: string;
  source?: string;
  cookies: EastmoneyJywgCookie[];
  fingerprint?: {
    login_url?: string;
    trade_url?: string;
  };
}

export interface EastmoneyJywgProfileConfig {
  account_alias: string;
  base_url: "https://jywg.18.cn";
  session_secret_path: string;
  browser_profile_dir: string;
  snapshot_dir: string;
  redaction: EastmoneyJywgRedactionLevel;
  top_positions_limit: number;
  include_orders: boolean;
  include_deals: boolean;
  allow_non_jywg_host: boolean;
  fail_on_login_challenge: boolean;
  show_total_assets: boolean;
}

export interface EastmoneyJywgConfig {
  profiles: Record<string, EastmoneyJywgProfileConfig>;
}

export interface EastmoneyJywgToolRequest {
  profile?: string;
  account_alias?: string;
  redaction?: EastmoneyJywgRedactionLevel;
  market_session?: string;
  top_positions_limit?: number;
}

export interface EastmoneyJywgHealthCheck {
  ok: boolean;
  host: string;
  session: {
    ok: boolean;
    cookie_count: number;
    last_verified_at?: string;
    error?: string;
  };
}

export interface EastmoneyJywgRawBrokerData {
  captured_at: string;
  asset_and_position: unknown;
  positions: unknown;
  orders?: unknown;
  deals?: unknown;
  updated_session: EastmoneyJywgSession;
  warnings: string[];
}

export interface EastmoneyJywgPositionSummary {
  code: string;
  name: string;
  currency: string;
  quantity?: number;
  available_quantity?: number;
  cost_price?: number;
  last_price?: number;
  market_value?: number;
  daily_pnl?: number;
  daily_pnl_ratio?: number;
  floating_pnl?: number;
  pnl_ratio?: number;
}

export interface EastmoneyJywgAccountSnapshot {
  broker: "eastmoney-jywg";
  account_alias: string;
  captured_at: string;
  currency: string;
  market_session: string;
  total_assets?: number;
  market_value?: number;
  expanded_market_value?: number;
  unclassified_market_value?: number;
  cash_available?: number;
  balance?: number;
  daily_pnl?: number;
  floating_pnl?: number;
  cumulative_pnl?: number;
  daily_pnl_pct?: number;
  positions: EastmoneyJywgPositionSummary[];
  warnings: string[];
}

export interface EastmoneyJywgClientOptions {
  includeOrders?: boolean;
  includeDeals?: boolean;
}

export interface EastmoneyJywgClient {
  healthCheck(profile: EastmoneyJywgProfileConfig, session: EastmoneyJywgSession): Promise<EastmoneyJywgHealthCheck>;
  getRawBrokerData(
    profile: EastmoneyJywgProfileConfig,
    session: EastmoneyJywgSession,
    options?: EastmoneyJywgClientOptions,
  ): Promise<EastmoneyJywgRawBrokerData>;
}
