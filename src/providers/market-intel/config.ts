import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import type {
  MarketIntelCalendarConfig,
  MarketIntelCalendarProvider,
  MarketIntelEarlyClose,
  MarketIntelMarket,
  MarketIntelMarketConfig,
  MarketIntelMarketScope,
  MarketIntelProviderConfig,
  MarketIntelQualityConfig,
  MarketIntelSession,
  MarketIntelSourcesConfig,
  MarketIntelTimeWindow,
  MarketIntelWatchlistsConfig,
} from "./types.js";
import { parseTimeToMinutes } from "../../stock/data/market-calendar.js";

const CONFIG_DIR_DEFAULT = join(homedir(), ".miniclaw/providers/market-intel");
const RESERVED_PROVIDER_CONFIG_NAMES = new Set(["config"]);
const MARKET_SCOPES = new Set<MarketIntelMarketScope>(["us", "cn"]);
const SESSIONS = new Set<MarketIntelSession>(["pre_market"]);
const CALENDAR_PROVIDERS = new Set<MarketIntelCalendarProvider>(["static", "static_plus_remote"]);
const MARKETS = new Set<MarketIntelMarket>(["us", "cn-a", "hk"]);

const DEFAULT_MARKETS: Record<MarketIntelMarket, MarketIntelMarketConfig> = {
  us: {
    timezone: "America/New_York",
    sessions: [{ start: "09:30", end: "16:00" }],
    holidays: [],
    early_closes: [],
  },
  "cn-a": {
    timezone: "Asia/Shanghai",
    sessions: [{ start: "09:30", end: "11:30" }, { start: "13:00", end: "15:00" }],
    holidays: [],
    early_closes: [],
  },
  hk: {
    timezone: "Asia/Hong_Kong",
    sessions: [{ start: "09:30", end: "12:00" }, { start: "13:00", end: "16:00" }],
    holidays: [],
    early_closes: [],
  },
};

const DEFAULT_WATCHLISTS: Record<MarketIntelMarketScope, MarketIntelWatchlistsConfig> = {
  us: {
    indices: ["SPY", "QQQ", "IWM", "DIA"],
    sectors: ["XLK", "XLF", "XLE", "XLV", "XLY", "XLI"],
    macro: ["DXY", "VIX", "US10Y", "WTI", "GOLD"],
    cross_market: [],
    symbols: [],
  },
  cn: {
    indices: ["000001.SS", "399001.SZ", "^HSI", "^HSTECH"],
    sectors: ["semiconductor", "ai", "broker", "real_estate", "consumer", "healthcare", "new_energy"],
    macro: ["CNH", "A50", "HSI_FUTURES"],
    cross_market: ["A50", "CNH", "HSI_FUTURES"],
    symbols: [],
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

function nonNegativeInt(value: unknown, fallback: number, max: number, name: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`market-intel ${name} must be a non-negative integer`);
  return Math.min(parsed, max);
}

function stringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return value
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function marketScope(value: unknown): MarketIntelMarketScope {
  if (typeof value !== "string" || !MARKET_SCOPES.has(value as MarketIntelMarketScope)) {
    throw new Error(`market-intel market_scope must be one of: ${[...MARKET_SCOPES].join(", ")}`);
  }
  return value as MarketIntelMarketScope;
}

function session(value: unknown): MarketIntelSession {
  if (typeof value !== "string" || !SESSIONS.has(value as MarketIntelSession)) {
    throw new Error(`market-intel session must be one of: ${[...SESSIONS].join(", ")}`);
  }
  return value as MarketIntelSession;
}

function calendarProvider(value: unknown): MarketIntelCalendarProvider {
  if (value === undefined || value === null || value === "") return "static_plus_remote";
  if (typeof value !== "string" || !CALENDAR_PROVIDERS.has(value as MarketIntelCalendarProvider)) {
    throw new Error(`market-intel calendar.provider must be one of: ${[...CALENDAR_PROVIDERS].join(", ")}`);
  }
  return value as MarketIntelCalendarProvider;
}

function parseTime(value: unknown, fallback: string, name: string): string {
  const text = optionalString(value) ?? fallback;
  parseTimeToMinutes(text);
  return text;
}

function parseEarlyClose(raw: unknown, index: number): MarketIntelEarlyClose {
  if (typeof raw === "string") {
    const date = raw.trim();
    if (!date) throw new Error(`market-intel early_closes[${index}] must not be empty`);
    return { date, close: "13:00" };
  }
  if (!isPlainObject(raw)) throw new Error(`market-intel early_closes[${index}] must be a date string or object`);
  const date = optionalString(raw.date);
  if (!date) throw new Error(`market-intel early_closes[${index}].date is required`);
  return {
    date,
    close: parseTime(raw.close, "13:00", `early_closes[${index}].close`),
  };
}

function parseEarlyCloses(raw: unknown): MarketIntelEarlyClose[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseEarlyClose);
}

function parseCalendar(raw: unknown): MarketIntelCalendarConfig {
  const obj = isPlainObject(raw) ? raw : {};
  return {
    provider: calendarProvider(obj.provider),
    holidays: stringArray(obj.holidays),
    early_closes: parseEarlyCloses(obj.early_closes),
    fail_on_unknown_trade_date: boolValue(obj.fail_on_unknown_trade_date, false),
    skip_closed_market: boolValue(obj.skip_closed_market, true),
  };
}

function parseMarketSession(raw: unknown, fallback: MarketIntelTimeWindow, index: number): MarketIntelTimeWindow {
  if (!isPlainObject(raw)) throw new Error(`market-intel markets.sessions[${index}] must be an object`);
  return {
    start: parseTime(raw.start, fallback.start, `markets.sessions[${index}].start`),
    end: parseTime(raw.end, fallback.end, `markets.sessions[${index}].end`),
  };
}

function parseMarketConfig(
  raw: unknown,
  fallback: MarketIntelMarketConfig,
  calendar: MarketIntelCalendarConfig,
): MarketIntelMarketConfig {
  const obj = isPlainObject(raw) ? raw : {};
  const fallbackSession = fallback.sessions[0] ?? { start: "09:30", end: "16:00" };
  const sessionsRaw = Array.isArray(obj.sessions) ? obj.sessions : fallback.sessions;
  const sessions = sessionsRaw.map((item, index) => parseMarketSession(item, fallbackSession, index));
  return {
    timezone: optionalString(obj.timezone) ?? fallback.timezone,
    sessions,
    holidays: [...new Set([...calendar.holidays, ...stringArray(obj.holidays, fallback.holidays)])],
    early_closes: [...calendar.early_closes, ...parseEarlyCloses(obj.early_closes)],
  };
}

function parseMarkets(
  raw: unknown,
  scope: MarketIntelMarketScope,
  calendar: MarketIntelCalendarConfig,
): Partial<Record<MarketIntelMarket, MarketIntelMarketConfig>> {
  const obj = isPlainObject(raw) ? raw : {};
  const defaults = scope === "us" ? ["us"] as const : ["cn-a", "hk"] as const;
  const out: Partial<Record<MarketIntelMarket, MarketIntelMarketConfig>> = {};
  for (const key of defaults) {
    out[key] = parseMarketConfig(obj[key], DEFAULT_MARKETS[key], calendar);
  }
  for (const [key, value] of Object.entries(obj)) {
    if (!MARKETS.has(key as MarketIntelMarket)) continue;
    out[key as MarketIntelMarket] = parseMarketConfig(value, DEFAULT_MARKETS[key as MarketIntelMarket], calendar);
  }
  return out;
}

function parseSources(raw: unknown, scope: MarketIntelMarketScope): MarketIntelSourcesConfig {
  const obj = isPlainObject(raw) ? raw : {};
  const quotes = isPlainObject(obj.quotes) ? obj.quotes : {};
  const macro = isPlainObject(obj.macro) ? obj.macro : {};
  const news = isPlainObject(obj.news) ? obj.news : {};
  const earnings = isPlainObject(obj.earnings) ? obj.earnings : {};
  const sectors = isPlainObject(obj.sectors) ? obj.sectors : {};
  return {
    quotes: {
      us_primary: optionalString(quotes.us_primary) ?? (scope === "us" ? "futu_opend" : undefined),
      hk_primary: optionalString(quotes.hk_primary) ?? (scope === "cn" ? "futu_opend" : undefined),
      cn_a_primary: optionalString(quotes.cn_a_primary) ?? (scope === "cn" ? "eastmoney_public_fallback" : undefined),
      fallback: stringArray(quotes.fallback, ["yahoo_chart_unofficial"]),
      optional_paid: stringArray(quotes.optional_paid),
    },
    macro: {
      federal_reserve: optionalString(macro.federal_reserve) ?? (scope === "us" ? "official_html_rss" : undefined),
      treasury: optionalString(macro.treasury) ?? (scope === "us" ? "official_xml_or_fiscaldata" : undefined),
      bls: optionalString(macro.bls) ?? (scope === "us" ? "official_public_api" : undefined),
      fred: optionalString(macro.fred),
      pboc: optionalString(macro.pboc) ?? (scope === "cn" ? "official_html" : undefined),
      nbs: optionalString(macro.nbs) ?? (scope === "cn" ? "official_html" : undefined),
    },
    news: {
      provider: optionalString(news.provider) ?? "official_first_web_fallback",
      max_items: nonNegativeInt(news.max_items, 40, 200, "sources.news.max_items"),
    },
    earnings: {
      provider: optionalString(earnings.provider) ?? (scope === "us" ? "sec_edgar" : "exchange_announcements"),
      max_items: nonNegativeInt(earnings.max_items, 40, 200, "sources.earnings.max_items"),
    },
    sectors: {
      provider: optionalString(sectors.provider) ?? (scope === "us" ? "sector_etf" : "exchange_or_public_fallback"),
    },
  };
}

function parseWatchlists(raw: unknown, scope: MarketIntelMarketScope): MarketIntelWatchlistsConfig {
  const obj = isPlainObject(raw) ? raw : {};
  const fallback = DEFAULT_WATCHLISTS[scope];
  return {
    indices: stringArray(obj.indices, fallback.indices),
    sectors: stringArray(obj.sectors, fallback.sectors),
    macro: stringArray(obj.macro, fallback.macro),
    cross_market: stringArray(obj.cross_market, fallback.cross_market),
    symbols: stringArray(obj.symbols, fallback.symbols),
  };
}

function parseQuality(raw: unknown): MarketIntelQualityConfig {
  const obj = isPlainObject(raw) ? raw : {};
  const maxStale = isPlainObject(obj.max_stale_minutes) ? obj.max_stale_minutes : {};
  return {
    max_stale_minutes: {
      quote: nonNegativeInt(maxStale.quote, 20, 1440, "quality.max_stale_minutes.quote"),
      news: nonNegativeInt(maxStale.news, 720, 10080, "quality.max_stale_minutes.news"),
      macro: nonNegativeInt(maxStale.macro, 10080, 43200, "quality.max_stale_minutes.macro"),
    },
    fail_if_all_quotes_fail: boolValue(obj.fail_if_all_quotes_fail, true),
    allow_partial_news: boolValue(obj.allow_partial_news, true),
  };
}

function configDir(): string {
  return process.env.MINICLAW_MARKET_INTEL_PROVIDER_CONFIG_DIR ?? CONFIG_DIR_DEFAULT;
}

function validateConfigName(name: string): void {
  if (!name || name.includes("/") || name.includes("..")) {
    throw new Error("market-intel provider config name must not be empty or include path separators");
  }
  if (RESERVED_PROVIDER_CONFIG_NAMES.has(name)) {
    throw new Error("market-intel provider config name 'config' is reserved");
  }
}

export function getMarketIntelProviderConfigPath(name = "default"): string {
  validateConfigName(name);
  return join(configDir(), `${name}.yaml`);
}

export function loadMarketIntelProviderConfig(name = "default"): MarketIntelProviderConfig {
  const path = getMarketIntelProviderConfigPath(name);
  if (!existsSync(path)) throw new Error(`market-intel provider config not found: ${path}`);
  const raw = yamlLoad(readFileSync(path, "utf8")) as unknown;
  if (!isPlainObject(raw)) throw new Error(`market-intel provider config must be a YAML object: ${path}`);
  const scope = marketScope(raw.market_scope);
  const calendar = parseCalendar(raw.calendar);
  return {
    market_scope: scope,
    session: session(raw.session),
    timezone: optionalString(raw.timezone) ?? (scope === "us" ? "America/New_York" : "Asia/Shanghai"),
    portfolio_provider_config: optionalString(raw.portfolio_provider_config),
    calendar,
    markets: parseMarkets(raw.markets, scope, calendar),
    sources: parseSources(raw.sources, scope),
    watchlists: parseWatchlists(raw.watchlists, scope),
    quality: parseQuality(raw.quality),
  };
}
