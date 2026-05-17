import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import type { MarketForecastBenchmarkConfig, MarketForecastEvaluationProviderConfig } from "../../stock/signals/forecast-evaluation-types.js";
import type { MarketIntelMarketScope } from "../../stock/data/market-intel-types.js";

const CONFIG_DIR_DEFAULT = join(homedir(), ".miniclaw/providers/market-forecast-evaluation");
const RESERVED_PROVIDER_CONFIG_NAMES = new Set(["config"]);
const MARKET_SCOPES = new Set<MarketIntelMarketScope>(["us", "cn"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function marketScope(value: unknown): MarketIntelMarketScope {
  if (typeof value !== "string" || !MARKET_SCOPES.has(value as MarketIntelMarketScope)) {
    throw new Error(`market-forecast-evaluation market_scope must be one of: ${[...MARKET_SCOPES].join(", ")}`);
  }
  return value as MarketIntelMarketScope;
}

function parseBenchmark(raw: unknown): MarketForecastBenchmarkConfig {
  if (typeof raw === "string" && raw.trim()) return { symbol: raw.trim() };
  if (!isPlainObject(raw)) throw new Error("market-forecast-evaluation benchmark_symbols[] must be string or object");
  const symbol = optionalString(raw.symbol);
  if (!symbol) throw new Error("market-forecast-evaluation benchmark symbol is required");
  return {
    symbol,
    provider_symbol: optionalString(raw.provider_symbol),
    label: optionalString(raw.label),
  };
}

function configDir(): string {
  return process.env.MINICLAW_MARKET_FORECAST_EVALUATION_CONFIG_DIR ?? CONFIG_DIR_DEFAULT;
}

function validateConfigName(name: string): void {
  if (!name || name.includes("/") || name.includes("..")) {
    throw new Error("market-forecast-evaluation provider config name must not be empty or include path separators");
  }
  if (RESERVED_PROVIDER_CONFIG_NAMES.has(name)) {
    throw new Error("market-forecast-evaluation provider config name 'config' is reserved");
  }
}

export function getMarketForecastEvaluationProviderConfigPath(name = "default"): string {
  validateConfigName(name);
  return join(configDir(), `${name}.yaml`);
}

export function loadMarketForecastEvaluationProviderConfig(name = "default"): MarketForecastEvaluationProviderConfig {
  const path = getMarketForecastEvaluationProviderConfigPath(name);
  if (!existsSync(path)) throw new Error(`market-forecast-evaluation provider config not found: ${path}`);
  const raw = yamlLoad(readFileSync(path, "utf8")) as unknown;
  if (!isPlainObject(raw)) throw new Error(`market-forecast-evaluation provider config must be a YAML object: ${path}`);
  if (!Array.isArray(raw.benchmark_symbols) || raw.benchmark_symbols.length === 0) {
    throw new Error("market-forecast-evaluation provider config requires benchmark_symbols[]");
  }
  return {
    market_scope: marketScope(raw.market_scope),
    timezone: optionalString(raw.timezone) ?? (raw.market_scope === "us" ? "America/New_York" : "Asia/Shanghai"),
    forecast_session: "pre_market",
    portfolio_provider_config: optionalString(raw.portfolio_provider_config),
    direction_threshold_pct: positiveNumber(raw.direction_threshold_pct, 0.2),
    benchmark_symbols: raw.benchmark_symbols.map(parseBenchmark),
  };
}
