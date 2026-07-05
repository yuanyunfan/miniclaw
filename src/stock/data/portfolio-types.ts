import type { StockProviderResult, StockProviderRunArgs } from "../types.js";
import type { AssetAllocationCategory, AssetAllocationHolding } from "./asset-allocation.js";

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
  include_equity_lookthrough_summary: boolean;
  include_equity_lookthrough_chart: boolean;
  equity_lookthrough_top_limit: number;
  equity_lookthrough_sources: StockPortfolioEquityLookthroughSourceConfig[];
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
  equity_lookthrough_summary?: StockPortfolioEquityLookthroughSummary;
  position_premium_summary?: StockPortfolioPositionPremiumSummary;
  warnings: string[];
  usage_notes: string[];
  sources: StockPortfolioSourceResult[];
}

export type StockPortfolioSourceRunner = (args: StockProviderRunArgs) => Promise<StockProviderResult>;

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
  category?: AssetAllocationCategory;
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

export interface StockPortfolioEquityLookthroughConstituentConfig {
  company_key?: string;
  company: string;
  code: string;
  aliases: string[];
  weight_pct: number;
}

export type StockPortfolioEquityLookthroughSourceType = "http_json" | "http_csv" | "http_xlsx";

export interface StockPortfolioEquityLookthroughColumnConfig {
  company: string[];
  code: string[];
  weight_pct: string[];
}

export interface StockPortfolioEquityLookthroughDataSourceConfig {
  type: StockPortfolioEquityLookthroughSourceType;
  url: string;
  items_path?: string;
  columns: StockPortfolioEquityLookthroughColumnConfig;
  timeout_ms: number;
  user_agent?: string;
}

export interface StockPortfolioEquityLookthroughAliasConfig {
  company_key: string;
  company: string;
  code: string;
  aliases: string[];
}

export interface StockPortfolioEquityLookthroughSourceConfig {
  label: string;
  match_codes: string[];
  match_names: string[];
  data_source?: StockPortfolioEquityLookthroughDataSourceConfig;
  company_aliases: StockPortfolioEquityLookthroughAliasConfig[];
  constituents: StockPortfolioEquityLookthroughConstituentConfig[];
}

export interface StockPortfolioEquityLookthroughSourceContribution {
  label: string;
  amount_cny: number;
}

export interface StockPortfolioEquityLookthroughRow {
  rank: number;
  company_key: string;
  company: string;
  code: string;
  lookthrough_amount_cny: number;
  percentage_of_total_assets_cny?: number;
  percentage_of_stock_position_cny?: number;
  source_labels: string[];
  sources: StockPortfolioEquityLookthroughSourceContribution[];
}

export interface StockPortfolioEquityLookthroughSummary {
  base_currency: string;
  total_assets_cny?: number;
  stock_position_cny: number;
  expanded_amount_cny: number;
  expanded_stock_position_percentage?: number;
  top_limit: number;
  rows: StockPortfolioEquityLookthroughRow[];
  warnings: string[];
  usage_notes: string[];
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
