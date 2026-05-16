import type { PreProviderResult, PreProviderRunArgs } from "../types.js";
import type { AssetAllocationCategory, AssetAllocationHolding } from "../asset-allocation.js";

export type StockPortfolioSourceName = "futu-stock" | "eastmoney-jywg-readonly" | "eastmoney-etf-premium";
export type StockPortfolioMarketScope = "all" | "us" | "cn";

export interface StockPortfolioSourceConfig {
  provider: StockPortfolioSourceName;
  config?: string;
  label?: string;
  asset_account_label?: string;
  enabled: boolean;
  required: boolean;
  include_asset_totals: boolean;
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
  include_asset_summary: boolean;
  include_asset_pie_chart: boolean;
}

export interface StockPortfolioSourceOk {
  provider: StockPortfolioSourceName;
  config: string;
  label?: string;
  asset_account_label?: string;
  include_asset_totals?: boolean;
  status: "ok";
  payload: Record<string, unknown>;
}

export interface StockPortfolioSourceError {
  provider: StockPortfolioSourceName;
  config: string;
  label?: string;
  asset_account_label?: string;
  include_asset_totals?: boolean;
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
  cny_summary?: StockPortfolioCnySummary;
  asset_summary?: StockPortfolioAssetSummary;
  position_premium_summary?: StockPortfolioPositionPremiumSummary;
  warnings: string[];
  usage_notes: string[];
  sources: StockPortfolioSourceResult[];
}

export type StockPortfolioSourceRunner = (args: PreProviderRunArgs) => Promise<PreProviderResult>;

export interface StockPortfolioCnyPosition {
  provider: StockPortfolioSourceName;
  config: string;
  label?: string;
  code: string;
  name: string;
  instrument_type: "stock" | "etf";
  source_currency: string;
  pnl_cny: number;
  fx_rate_to_cny: number;
  pnl_ratio?: number;
}

export interface StockPortfolioCurrencyPnlSummary {
  source_currency: string;
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

export interface StockPortfolioAssetHolding extends Omit<AssetAllocationHolding, "currency" | "market_value"> {
  provider: StockPortfolioSourceName;
  config: string;
  source_label?: string;
  source_currency: string;
  market_value_cny: number;
  fx_rate_to_cny: number;
}

export type StockPortfolioLlmClassificationCategory =
  | "domestic_equity"
  | "foreign_equity"
  | "bond"
  | "gold";

export interface StockPortfolioClassifiableHolding {
  provider: StockPortfolioSourceName;
  config: string;
  source_label?: string;
  code: string;
  name: string;
  source_currency: string;
  market_value_cny: number;
  fx_rate_to_cny: number;
  instrument_type?: string;
}

export interface StockPortfolioClassificationCategoryGuide {
  category: StockPortfolioLlmClassificationCategory;
  label: string;
  description: string;
}

export interface StockPortfolioClassificationGuidance {
  mode: "llm";
  categories: StockPortfolioClassificationCategoryGuide[];
  cash_handling: string;
  instructions: string[];
}

export interface StockPortfolioAssetAccountSummary {
  provider: StockPortfolioSourceName;
  config: string;
  label?: string;
  account_alias?: string;
  source_currency: string;
  fx_rate_to_cny: number;
  total_assets_cny?: number;
  market_value_cny?: number;
  cash_cny?: number;
}

export interface StockPortfolioAssetCategorySummary {
  category: AssetAllocationCategory;
  label: string;
  market_value_cny: number;
  percentage_of_total_assets_cny?: number;
  positions_count: number;
  holdings: StockPortfolioAssetHolding[];
}

export interface StockPortfolioAssetSummary {
  base_currency: string;
  fx_rates: Record<string, number>;
  fx_rates_as_of?: string;
  fx_rates_source?: string;
  total_assets_cny?: number;
  market_value_cny?: number;
  cash_cny?: number;
  by_account: StockPortfolioAssetAccountSummary[];
  by_category: StockPortfolioAssetCategorySummary[];
  holdings_for_classification: StockPortfolioClassifiableHolding[];
  classification_guidance: StockPortfolioClassificationGuidance;
  warnings: string[];
}

export interface StockPortfolioPositionPremium {
  provider: StockPortfolioSourceName;
  config: string;
  label?: string;
  code: string;
  name: string;
  source_currency: string;
  data_source: "eastmoney_position" | "eastmoney_fund_selector";
  status: "ok" | "missing_from_eastmoney_position";
  captured_at?: string;
  premium_rate?: number;
  eastmoney_discount_ratio?: number;
  reference_nav?: number;
  iopv?: number;
  last_price?: number;
  premium_source_provider?: "eastmoney-etf-premium";
  premium_source_config?: string;
  premium_source_label?: string;
  premium_source_name?: string;
  note?: string;
}

export interface StockPortfolioPositionPremiumSummary {
  source: "eastmoney_position" | "eastmoney_position_with_fund_selector";
  items: StockPortfolioPositionPremium[];
  warnings: string[];
  usage_notes: string[];
}
