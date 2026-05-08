import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import type {
  StockPulseInstrumentType,
  StockPulseMarket,
  StockPulseMarketConfig,
  StockPulseMarketScope,
  StockPulseProviderConfig,
  StockPulseQuoteConfig,
  StockPulseSymbolConfig,
  StockPulseThresholdConfig,
  StockPulseThresholdRule,
  StockPulseTimeWindow,
  StockPulseUniverseConfig,
  StockPulseUniverseSourceConfig,
} from "./types.js";
import { parseTimeToMinutes } from "./market.js";

const CONFIG_DIR_DEFAULT = join(homedir(), ".miniclaw/providers/stock-pulse");
const RESERVED_PROVIDER_CONFIG_NAMES = new Set(["config"]);
const MARKETS = new Set<StockPulseMarket>(["us", "cn-a", "hk"]);
const MARKET_SCOPES = new Set<StockPulseMarketScope>(["us", "cn"]);
const INSTRUMENT_TYPES = new Set<StockPulseInstrumentType>(["stock", "etf", "leveraged_etf"]);

const DEFAULT_THRESHOLD_STOCK: StockPulseThresholdRule = {
  hour_abs_pct: 2,
  day_abs_pct: 4,
  bar_abs_pct: 0.6,
  bar_sigma_multiplier: 2,
  abnormal_bar_count: 3,
  same_direction_bars: 10,
  z_score: 2,
  urgent_z_score: 3,
};

const DEFAULT_THRESHOLD_ETF: StockPulseThresholdRule = {
  hour_abs_pct: 1,
  day_abs_pct: 2,
  bar_abs_pct: 0.35,
  bar_sigma_multiplier: 2,
  abnormal_bar_count: 3,
  same_direction_bars: 10,
  z_score: 2,
  urgent_z_score: 3,
};

const DEFAULT_THRESHOLD_LEVERAGED_ETF: StockPulseThresholdRule = {
  hour_abs_pct: 2,
  day_abs_pct: 4,
  bar_abs_pct: 0.8,
  bar_sigma_multiplier: 2,
  abnormal_bar_count: 3,
  same_direction_bars: 10,
  z_score: 2.5,
  urgent_z_score: 3.5,
};

const DEFAULT_MARKETS: Record<StockPulseMarket, StockPulseMarketConfig> = {
  us: {
    timezone: "America/New_York",
    sessions: [{ start: "09:30", end: "16:00" }],
    holidays: [],
  },
  "cn-a": {
    timezone: "Asia/Shanghai",
    sessions: [{ start: "09:30", end: "11:30" }, { start: "13:00", end: "15:00" }],
    holidays: [],
  },
  hk: {
    timezone: "Asia/Hong_Kong",
    sessions: [{ start: "09:30", end: "12:00" }, { start: "13:00", end: "16:00" }],
    holidays: [],
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function positiveNumber(value: unknown, fallback: number, name: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`stock-pulse ${name} must be a positive number`);
  return parsed;
}

function nonNegativeInt(value: unknown, fallback: number, max: number, name: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`stock-pulse ${name} must be a non-negative integer`);
  return Math.min(parsed, max);
}

function marketScope(value: unknown): StockPulseMarketScope {
  if (typeof value !== "string" || !MARKET_SCOPES.has(value as StockPulseMarketScope)) {
    throw new Error(`stock-pulse market_scope must be one of: ${[...MARKET_SCOPES].join(", ")}`);
  }
  return value as StockPulseMarketScope;
}

function market(value: unknown, name = "market"): StockPulseMarket {
  if (typeof value !== "string" || !MARKETS.has(value as StockPulseMarket)) {
    throw new Error(`stock-pulse ${name} must be one of: ${[...MARKETS].join(", ")}`);
  }
  return value as StockPulseMarket;
}

function parseTime(value: unknown, fallback: string, name: string): string {
  const text = optionalString(value) ?? fallback;
  parseTimeToMinutes(text);
  return text;
}

function parseActiveWindow(raw: unknown): StockPulseTimeWindow {
  const obj = isPlainObject(raw) ? raw : {};
  return {
    timezone: optionalString(obj.timezone) ?? "Asia/Shanghai",
    start: parseTime(obj.start, "09:30", "active_window.start"),
    end: parseTime(obj.end, "01:00", "active_window.end"),
  };
}

function parseMarketConfig(raw: unknown, fallback: StockPulseMarketConfig): StockPulseMarketConfig {
  const obj = isPlainObject(raw) ? raw : {};
  const sessionsRaw = Array.isArray(obj.sessions) ? obj.sessions : fallback.sessions;
  const sessions = sessionsRaw.map((item, index) => {
    if (!isPlainObject(item)) throw new Error(`stock-pulse markets.sessions[${index}] must be an object`);
    return {
      start: parseTime(item.start, fallback.sessions[0]?.start ?? "09:30", `markets.sessions[${index}].start`),
      end: parseTime(item.end, fallback.sessions[0]?.end ?? "16:00", `markets.sessions[${index}].end`),
    };
  });
  return {
    timezone: optionalString(obj.timezone) ?? fallback.timezone,
    sessions,
    holidays: Array.isArray(obj.holidays) ? obj.holidays.map(String) : fallback.holidays,
  };
}

function parseMarkets(raw: unknown, scope: StockPulseMarketScope): Partial<Record<StockPulseMarket, StockPulseMarketConfig>> {
  const obj = isPlainObject(raw) ? raw : {};
  const defaults = scope === "us" ? ["us"] as const : ["cn-a", "hk"] as const;
  const out: Partial<Record<StockPulseMarket, StockPulseMarketConfig>> = {};
  for (const key of defaults) {
    out[key] = parseMarketConfig(obj[key], DEFAULT_MARKETS[key]);
  }
  for (const [key, value] of Object.entries(obj)) {
    if (!MARKETS.has(key as StockPulseMarket)) continue;
    out[key as StockPulseMarket] = parseMarketConfig(value, DEFAULT_MARKETS[key as StockPulseMarket]);
  }
  return out;
}

function parseSymbol(raw: unknown): StockPulseSymbolConfig {
  if (!isPlainObject(raw)) throw new Error("stock-pulse universe.symbols[] must be an object");
  const symbol = optionalString(raw.symbol);
  if (!symbol) throw new Error("stock-pulse universe.symbols[].symbol is required");
  const type = optionalString(raw.instrument_type);
  if (type && !INSTRUMENT_TYPES.has(type as StockPulseInstrumentType)) {
    throw new Error("stock-pulse universe.symbols[].instrument_type must be stock, etf, or leveraged_etf");
  }
  return {
    symbol,
    name: optionalString(raw.name),
    market: raw.market === undefined ? undefined : market(raw.market, "universe.symbols[].market"),
    yahoo_symbol: optionalString(raw.yahoo_symbol),
    instrument_type: type as StockPulseInstrumentType | undefined,
    source: optionalString(raw.source),
  };
}

function parseUniverseSource(raw: unknown): StockPulseUniverseSourceConfig {
  if (!isPlainObject(raw)) throw new Error("stock-pulse universe.sources[] must be an object");
  const type = optionalString(raw.type);
  if (type !== "yahoo_screener" && type !== "eastmoney_clist") {
    throw new Error("stock-pulse universe.sources[].type must be yahoo_screener or eastmoney_clist");
  }
  const name = optionalString(raw.name) ?? `${type}-${optionalString(raw.scr_id) ?? optionalString(raw.fs) ?? "source"}`;
  const parsed: StockPulseUniverseSourceConfig = {
    type,
    name,
    market: market(raw.market, "universe.sources[].market"),
    enabled: boolValue(raw.enabled, true),
    limit: nonNegativeInt(raw.limit, 50, 200, "universe.sources[].limit"),
    scr_id: optionalString(raw.scr_id),
    fs: optionalString(raw.fs),
  };
  if (type === "yahoo_screener" && !parsed.scr_id) throw new Error("stock-pulse yahoo_screener source requires scr_id");
  if (type === "eastmoney_clist" && !parsed.fs) throw new Error("stock-pulse eastmoney_clist source requires fs");
  return parsed;
}

function parseUniverse(raw: unknown): StockPulseUniverseConfig {
  const obj = isPlainObject(raw) ? raw : {};
  return {
    enabled: boolValue(obj.enabled, true),
    include_portfolio: boolValue(obj.include_portfolio, true),
    include_watchlist: boolValue(obj.include_watchlist, true),
    include_sources: boolValue(obj.include_sources, true),
    max_symbols: nonNegativeInt(obj.max_symbols, 80, 300, "universe.max_symbols"),
    symbols: Array.isArray(obj.symbols) ? obj.symbols.map(parseSymbol) : [],
    sources: Array.isArray(obj.sources) ? obj.sources.map(parseUniverseSource).filter((source) => source.enabled) : [],
  };
}

function parseQuote(raw: unknown): StockPulseQuoteConfig {
  const obj = isPlainObject(raw) ? raw : {};
  const interval = optionalString(obj.interval) ?? "5m";
  if (interval !== "5m" && interval !== "15m") throw new Error("stock-pulse quote.interval must be 5m or 15m");
  const range = optionalString(obj.range) ?? "60d";
  if (range !== "5d" && range !== "1mo" && range !== "60d") throw new Error("stock-pulse quote.range must be 5d, 1mo, or 60d");
  return {
    provider: "yahoo",
    interval,
    range,
    include_prepost: boolValue(obj.include_prepost, false),
    timeout_ms: nonNegativeInt(obj.timeout_ms, 8000, 60000, "quote.timeout_ms"),
    concurrency: nonNegativeInt(obj.concurrency, 4, 12, "quote.concurrency"),
  };
}

function parseThresholdRule(raw: unknown, fallback: StockPulseThresholdRule, name: string): StockPulseThresholdRule {
  const obj = isPlainObject(raw) ? raw : {};
  return {
    hour_abs_pct: positiveNumber(obj.hour_abs_pct, fallback.hour_abs_pct, `${name}.hour_abs_pct`),
    day_abs_pct: positiveNumber(obj.day_abs_pct, fallback.day_abs_pct, `${name}.day_abs_pct`),
    bar_abs_pct: positiveNumber(obj.bar_abs_pct, fallback.bar_abs_pct, `${name}.bar_abs_pct`),
    bar_sigma_multiplier: positiveNumber(obj.bar_sigma_multiplier, fallback.bar_sigma_multiplier, `${name}.bar_sigma_multiplier`),
    abnormal_bar_count: nonNegativeInt(obj.abnormal_bar_count, fallback.abnormal_bar_count, 50, `${name}.abnormal_bar_count`),
    same_direction_bars: nonNegativeInt(obj.same_direction_bars, fallback.same_direction_bars, 50, `${name}.same_direction_bars`),
    z_score: positiveNumber(obj.z_score, fallback.z_score, `${name}.z_score`),
    urgent_z_score: positiveNumber(obj.urgent_z_score, fallback.urgent_z_score, `${name}.urgent_z_score`),
  };
}

function parseThresholds(raw: unknown): StockPulseThresholdConfig {
  const obj = isPlainObject(raw) ? raw : {};
  return {
    stock: parseThresholdRule(obj.stock, DEFAULT_THRESHOLD_STOCK, "thresholds.stock"),
    etf: parseThresholdRule(obj.etf, DEFAULT_THRESHOLD_ETF, "thresholds.etf"),
    leveraged_etf: parseThresholdRule(obj.leveraged_etf, DEFAULT_THRESHOLD_LEVERAGED_ETF, "thresholds.leveraged_etf"),
  };
}

function configDir(): string {
  return process.env.MINICLAW_STOCK_PULSE_PROVIDER_CONFIG_DIR ?? CONFIG_DIR_DEFAULT;
}

function validateConfigName(name: string): void {
  if (!name || name.includes("/") || name.includes("..")) {
    throw new Error("stock-pulse provider config name must not be empty or include path separators");
  }
  if (RESERVED_PROVIDER_CONFIG_NAMES.has(name)) {
    throw new Error("stock-pulse provider config name 'config' is reserved");
  }
}

export function getStockPulseProviderConfigPath(name = "default"): string {
  validateConfigName(name);
  return join(configDir(), `${name}.yaml`);
}

export function loadStockPulseProviderConfig(name = "default"): StockPulseProviderConfig {
  const path = getStockPulseProviderConfigPath(name);
  if (!existsSync(path)) throw new Error(`stock-pulse provider config not found: ${path}`);
  const raw = yamlLoad(readFileSync(path, "utf8")) as unknown;
  if (!isPlainObject(raw)) throw new Error(`stock-pulse provider config must be a YAML object: ${path}`);
  const scope = marketScope(raw.market_scope);
  return {
    market_scope: scope,
    portfolio_provider_config: optionalString(raw.portfolio_provider_config),
    active_window: parseActiveWindow(raw.active_window),
    markets: parseMarkets(raw.markets, scope),
    universe: parseUniverse(raw.universe),
    quote: parseQuote(raw.quote),
    thresholds: parseThresholds(raw.thresholds),
  };
}
