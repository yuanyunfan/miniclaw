import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import type { StockPulseMarketScope } from "../stock-pulse/types.js";
import type { StockWatchlistResearchConfig, StockWatchlistResearchRunType } from "./types.js";

const CONFIG_DIR_DEFAULT = join(homedir(), ".miniclaw/providers/stock-watchlist-research");
const RESERVED_PROVIDER_CONFIG_NAMES = new Set(["config"]);
const MARKET_SCOPES = new Set<StockPulseMarketScope>(["us", "cn"]);
const RUN_TYPES = new Set<StockWatchlistResearchRunType>(["pre_market", "daily"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function nonNegativeInt(value: unknown, fallback: number, max: number, name: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`stock-watchlist-research ${name} must be a non-negative integer`);
  return Math.min(parsed, max);
}

function positiveInt(value: unknown, fallback: number, max: number, name: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`stock-watchlist-research ${name} must be a positive integer`);
  return Math.min(parsed, max);
}

function marketScope(value: unknown): StockPulseMarketScope {
  if (typeof value !== "string" || !MARKET_SCOPES.has(value as StockPulseMarketScope)) {
    throw new Error(`stock-watchlist-research market_scope must be one of: ${[...MARKET_SCOPES].join(", ")}`);
  }
  return value as StockPulseMarketScope;
}

function runType(value: unknown): StockWatchlistResearchRunType {
  if (typeof value !== "string" || !RUN_TYPES.has(value as StockWatchlistResearchRunType)) {
    throw new Error(`stock-watchlist-research run_type must be one of: ${[...RUN_TYPES].join(", ")}`);
  }
  return value as StockWatchlistResearchRunType;
}

function getConfigDir(): string {
  return process.env.MINICLAW_STOCK_WATCHLIST_RESEARCH_CONFIG_DIR ?? CONFIG_DIR_DEFAULT;
}

export function getStockWatchlistResearchConfigPath(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("stock-watchlist-research config name is required");
  if (trimmed.includes("/") || trimmed.includes("..")) throw new Error("stock-watchlist-research config name must not contain path separators");
  if (RESERVED_PROVIDER_CONFIG_NAMES.has(trimmed)) throw new Error(`stock-watchlist-research config name is reserved: ${trimmed}`);
  return join(getConfigDir(), `${trimmed}.yaml`);
}

function parseConfig(raw: unknown): StockWatchlistResearchConfig {
  const obj = isPlainObject(raw) ? raw : {};
  const scope = marketScope(obj.market_scope);
  const quote = isPlainObject(obj.quote) ? obj.quote : {};
  const research = isPlainObject(obj.research) ? obj.research : {};
  return {
    market_scope: scope,
    run_type: runType(obj.run_type),
    timezone: optionalString(obj.timezone) ?? (scope === "us" ? "America/New_York" : "Asia/Shanghai"),
    stock_pulse_config: optionalString(obj.stock_pulse_config) ?? (scope === "us" ? "us-hourly" : "cn-hourly"),
    market_intel_config: optionalString(obj.market_intel_config),
    max_symbols: positiveInt(obj.max_symbols, 20, 80, "max_symbols"),
    quote: {
      interval: optionalString(quote.interval) === "15m" ? "15m" : "5m",
      range: optionalString(quote.range) === "5d" || optionalString(quote.range) === "1mo" ? optionalString(quote.range) as "5d" | "1mo" : "60d",
      include_prepost: boolValue(quote.include_prepost, true),
      timeout_ms: positiveInt(quote.timeout_ms, 8000, 60000, "quote.timeout_ms"),
      concurrency: positiveInt(quote.concurrency, 4, 12, "quote.concurrency"),
    },
    research: {
      enabled: boolValue(research.enabled, true),
      news_count_per_symbol: nonNegativeInt(research.news_count_per_symbol, 3, 10, "research.news_count_per_symbol"),
      timeout_ms: positiveInt(research.timeout_ms, 8000, 60000, "research.timeout_ms"),
      concurrency: positiveInt(research.concurrency, 3, 8, "research.concurrency"),
    },
  };
}

export function loadStockWatchlistResearchConfig(name = "default"): StockWatchlistResearchConfig {
  const path = getStockWatchlistResearchConfigPath(name);
  if (!existsSync(path)) throw new Error(`stock-watchlist-research config not found: ${path}`);
  return parseConfig(yamlLoad(readFileSync(path, "utf8")) as unknown);
}
