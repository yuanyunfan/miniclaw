import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import type {
  StockPortfolioMarketScope,
  StockPortfolioProviderConfig,
  StockPortfolioSourceConfig,
  StockPortfolioSourceName,
} from "../../stock/data/portfolio-types.js";

const CONFIG_DIR_DEFAULT = join(homedir(), ".miniclaw/providers/stock-portfolio");
const RESERVED_PROVIDER_CONFIG_NAMES = new Set(["config"]);
const SOURCE_NAMES = new Set<StockPortfolioSourceName>(["futu-stock", "eastmoney-jywg-readonly", "eastmoney-etf-premium"]);
const MARKET_SCOPES = new Set<StockPortfolioMarketScope>(["all", "us", "cn"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function positiveNumberMap(value: unknown): Record<string, number> {
  if (!isPlainObject(value)) return { CNY: 1 };
  const mapped: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const currency = key.trim().toUpperCase();
    if (!currency) continue;
    const number = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : undefined;
    if (number === undefined || !Number.isFinite(number) || number <= 0) {
      throw new Error(`stock-portfolio fx_rates.${currency} must be a positive number`);
    }
    mapped[currency] = number;
  }
  return Object.keys(mapped).length ? { CNY: 1, ...mapped } : { CNY: 1 };
}

function nonNegativeInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return fallback;
  return Math.min(value, max);
}

function marketScope(value: unknown): StockPortfolioMarketScope {
  if (value === undefined || value === null || value === "") return "all";
  if (typeof value !== "string" || !MARKET_SCOPES.has(value as StockPortfolioMarketScope)) {
    throw new Error(`stock-portfolio market_scope must be one of: ${[...MARKET_SCOPES].join(", ")}`);
  }
  return value as StockPortfolioMarketScope;
}

function sourceName(value: unknown): StockPortfolioSourceName {
  if (typeof value !== "string" || !SOURCE_NAMES.has(value as StockPortfolioSourceName)) {
    throw new Error(`stock-portfolio source provider must be one of: ${[...SOURCE_NAMES].join(", ")}`);
  }
  return value as StockPortfolioSourceName;
}

function parseSource(raw: unknown): StockPortfolioSourceConfig {
  if (!isPlainObject(raw)) throw new Error("stock-portfolio sources[] must be a YAML object");
  return {
    provider: sourceName(raw.provider),
    config: optionalString(raw.config),
    label: optionalString(raw.label),
    asset_account_label: optionalString(raw.asset_account_label),
    enabled: boolValue(raw.enabled, true),
    required: boolValue(raw.required, false),
    include_asset_totals: boolValue(raw.include_asset_totals, true),
  };
}

function configDir(): string {
  return process.env.MINICLAW_STOCK_PORTFOLIO_PROVIDER_CONFIG_DIR ?? CONFIG_DIR_DEFAULT;
}

function validateConfigName(name: string): void {
  if (!name || name.includes("/") || name.includes("..")) {
    throw new Error("stock-portfolio provider config name must not be empty or include path separators");
  }
  if (RESERVED_PROVIDER_CONFIG_NAMES.has(name)) {
    throw new Error("stock-portfolio provider config name 'config' is reserved");
  }
}

export function getStockPortfolioProviderConfigPath(name = "default"): string {
  validateConfigName(name);
  return join(configDir(), `${name}.yaml`);
}

export function loadStockPortfolioProviderConfig(name = "default"): StockPortfolioProviderConfig {
  const path = getStockPortfolioProviderConfigPath(name);
  if (!existsSync(path)) throw new Error(`stock-portfolio provider config not found: ${path}`);
  const raw = yamlLoad(readFileSync(path, "utf8")) as unknown;
  if (!isPlainObject(raw)) throw new Error(`stock-portfolio provider config must be a YAML object: ${path}`);
  if (!Array.isArray(raw.sources)) throw new Error("stock-portfolio provider config requires sources[]");
  const sources = raw.sources.map(parseSource).filter((source) => source.enabled);
  if (!sources.length) throw new Error("stock-portfolio provider config requires at least one enabled source");
  return {
    sources,
    continue_on_error: boolValue(raw.continue_on_error, true),
    fail_if_all_sources_fail: boolValue(raw.fail_if_all_sources_fail, true),
    market_scope: marketScope(raw.market_scope),
    base_currency: optionalString(raw.base_currency)?.toUpperCase() ?? "CNY",
    fx_rates: positiveNumberMap(raw.fx_rates),
    fx_rates_as_of: optionalString(raw.fx_rates_as_of),
    fx_rates_source: optionalString(raw.fx_rates_source),
    top_movers_limit: nonNegativeInt(raw.top_movers_limit, 5, 20),
    include_cny_summary: boolValue(raw.include_cny_summary, true),
    include_asset_summary: boolValue(raw.include_asset_summary, false),
    include_asset_pie_chart: boolValue(raw.include_asset_pie_chart, false),
  };
}
