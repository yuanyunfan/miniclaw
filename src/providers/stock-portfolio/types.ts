import type { PreProviderResult, PreProviderRunArgs } from "../types.js";

export type StockPortfolioSourceName = "futu-stock" | "eastmoney-jywg-readonly";
export type StockPortfolioMarketScope = "all" | "us" | "cn";

export interface StockPortfolioSourceConfig {
  provider: StockPortfolioSourceName;
  config?: string;
  label?: string;
  enabled: boolean;
  required: boolean;
}

export interface StockPortfolioProviderConfig {
  sources: StockPortfolioSourceConfig[];
  continue_on_error: boolean;
  fail_if_all_sources_fail: boolean;
  market_scope: StockPortfolioMarketScope;
  base_currency: string;
  fx_rates: Record<string, number>;
  fx_rates_as_of?: string;
  fx_rates_source?: string;
  top_movers_limit: number;
  include_cny_summary: boolean;
}

export interface StockPortfolioSourceOk {
  provider: StockPortfolioSourceName;
  config: string;
  label?: string;
  status: "ok";
  payload: Record<string, unknown>;
}

export interface StockPortfolioSourceError {
  provider: StockPortfolioSourceName;
  config: string;
  label?: string;
  status: "error";
  error: string;
}

export type StockPortfolioSourceResult = StockPortfolioSourceOk | StockPortfolioSourceError;

export interface StockPortfolioPayload {
  generated_at: string;
  source: "stock-portfolio";
  profile: string;
  market_scope: StockPortfolioMarketScope;
  ok_count: number;
  failed_count: number;
  sources: StockPortfolioSourceResult[];
  cny_summary?: StockPortfolioCnySummary;
  warnings: string[];
  usage_notes: string[];
}

export type StockPortfolioSourceRunner = (args: PreProviderRunArgs) => Promise<PreProviderResult>;

export interface StockPortfolioCnyPosition {
  provider: StockPortfolioSourceName;
  config: string;
  label?: string;
  code: string;
  name: string;
  instrument_type: "stock" | "etf";
  currency: string;
  pnl: number;
  pnl_cny: number;
  fx_rate_to_cny: number;
  pnl_ratio?: number;
}

export interface StockPortfolioCurrencyPnlSummary {
  currency: string;
  gross_profit: number;
  gross_loss: number;
  net_pnl: number;
  gross_profit_cny: number;
  gross_loss_cny: number;
  net_pnl_cny: number;
  winners_count: number;
  losers_count: number;
  flat_count: number;
  positions_with_pnl_count: number;
  fx_rate_to_cny: number;
}

export interface StockPortfolioCnySummary {
  base_currency: string;
  fx_rates: Record<string, number>;
  fx_rates_as_of?: string;
  fx_rates_source?: string;
  gross_profit_cny: number;
  gross_loss_cny: number;
  net_pnl_cny: number;
  winners_count: number;
  losers_count: number;
  flat_count: number;
  positions_with_pnl_count: number;
  by_currency: StockPortfolioCurrencyPnlSummary[];
  top_gainers: StockPortfolioCnyPosition[];
  top_losers: StockPortfolioCnyPosition[];
  warnings: string[];
}
