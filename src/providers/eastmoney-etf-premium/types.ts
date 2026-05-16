export interface EastmoneyEtfPremiumSymbolConfig {
  code: string;
  name?: string;
}

export interface EastmoneyEtfPremiumProviderConfig {
  symbols: EastmoneyEtfPremiumSymbolConfig[];
  timeout_ms: number;
  concurrency: number;
}

export type EastmoneyEtfPremiumItemStatus = "ok" | "missing_from_eastmoney_fund_selector";

export interface EastmoneyEtfPremiumItem {
  code: string;
  name: string;
  configured_name?: string;
  secucode?: string;
  index_name?: string;
  data_source: "eastmoney_fund_selector";
  status: EastmoneyEtfPremiumItemStatus;
  captured_at: string;
  premium_rate?: number;
  eastmoney_discount_ratio?: number;
  latest_price?: number;
  change_rate?: number;
  volume?: number;
  deal_amount?: number;
  quantity_relative_ratio?: number;
  high_price?: number;
  low_price?: number;
  pre_close_price?: number;
  dec_nav?: number;
  dec_totalshare?: number;
  note?: string;
}

export interface EastmoneyEtfPremiumSummary {
  source: "eastmoney_fund_selector";
  items: EastmoneyEtfPremiumItem[];
  warnings: string[];
  usage_notes: string[];
}

export interface EastmoneyEtfPremiumPayload {
  generated_at: string;
  source: "eastmoney-etf-premium";
  profile: string;
  premium_summary: EastmoneyEtfPremiumSummary;
  warnings: string[];
  usage_notes: string[];
}

export interface EastmoneyEtfPremiumClient {
  getFundSelectorRow(code: string, timeoutMs: number): Promise<Record<string, unknown> | undefined>;
}
