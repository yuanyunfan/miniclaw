import type { PreProviderResult, PreProviderRunArgs } from "../types.js";

export type StockPortfolioSourceName = "futu-stock" | "eastmoney-jywg-readonly";

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
  ok_count: number;
  failed_count: number;
  sources: StockPortfolioSourceResult[];
  warnings: string[];
  usage_notes: string[];
}

export type StockPortfolioSourceRunner = (args: PreProviderRunArgs) => Promise<PreProviderResult>;
