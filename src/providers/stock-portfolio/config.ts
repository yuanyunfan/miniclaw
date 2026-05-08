import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import type { StockPortfolioProviderConfig, StockPortfolioSourceConfig, StockPortfolioSourceName } from "./types.js";

const CONFIG_DIR_DEFAULT = join(homedir(), ".miniclaw/providers/stock-portfolio");
const RESERVED_PROVIDER_CONFIG_NAMES = new Set(["config"]);
const SOURCE_NAMES = new Set<StockPortfolioSourceName>(["futu-stock", "eastmoney-jywg-readonly"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
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
    enabled: boolValue(raw.enabled, true),
    required: boolValue(raw.required, false),
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
  };
}
