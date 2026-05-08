import type {
  StockPulseInstrumentType,
  StockPulseMarket,
  StockPulseMarketScope,
  StockPulseSymbol,
  StockPulseSymbolConfig,
  StockPulseUniverseSymbol,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function inferMarketFromCode(code: string, scope: StockPulseMarketScope): StockPulseMarket {
  const normalized = code.trim().toUpperCase();
  if (normalized.startsWith("US.")) return "us";
  if (normalized.startsWith("HK.")) return "hk";
  if (normalized.startsWith("SH.") || normalized.startsWith("SZ.")) return "cn-a";
  if (/^\d{6}$/.test(normalized)) return /^[56]/.test(normalized) ? "cn-a" : "cn-a";
  if (/^\d{1,5}$/.test(normalized) && scope === "cn") return "hk";
  return scope === "us" ? "us" : "cn-a";
}

function inferInstrumentType(code: string, name?: string, raw?: unknown): StockPulseInstrumentType {
  if (raw === "leveraged_etf" || raw === "etf" || raw === "stock") return raw;
  const text = `${code} ${name ?? ""}`;
  if (/\b(TQQQ|SQQQ|SOXL|SOXS|UPRO|SPXU|TNA|TZA)\b|2X|3X|杠杆|两倍|三倍/i.test(text)) return "leveraged_etf";
  if (/ETF|LOF|REIT|REITS|指数基金|交易型开放式/i.test(text)) return "etf";
  return "stock";
}

export function toYahooSymbol(code: string, market: StockPulseMarket): string {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return normalized;
  if (normalized.endsWith(".SS") || normalized.endsWith(".SZ") || normalized.endsWith(".HK")) return normalized;
  if (normalized.startsWith("US.")) return normalized.slice(3);
  if (normalized.startsWith("HK.")) return `${normalized.slice(3).padStart(4, "0")}.HK`;
  if (normalized.startsWith("SH.")) return `${normalized.slice(3)}.SS`;
  if (normalized.startsWith("SZ.")) return `${normalized.slice(3)}.SZ`;
  if (market === "hk") return `${normalized.padStart(4, "0")}.HK`;
  if (market === "cn-a") {
    if (/^[56]/.test(normalized)) return `${normalized}.SS`;
    return `${normalized}.SZ`;
  }
  return normalized;
}

function normalizeSymbol(
  raw: StockPulseSymbolConfig | StockPulseUniverseSymbol,
  scope: StockPulseMarketScope,
): StockPulseSymbol | undefined {
  const code = raw.symbol.trim();
  if (!code) return undefined;
  const market = raw.market ?? inferMarketFromCode(code, scope);
  return {
    symbol: code.toUpperCase(),
    name: raw.name,
    market,
    yahoo_symbol: raw.yahoo_symbol ?? toYahooSymbol(code, market),
    instrument_type: inferInstrumentType(code, raw.name, raw.instrument_type),
    sources: [raw.source ?? "watchlist"],
  };
}

function mergeSymbol(target: Map<string, StockPulseSymbol>, symbol: StockPulseSymbol): void {
  const key = `${symbol.market}:${symbol.yahoo_symbol.toUpperCase()}`;
  const existing = target.get(key);
  if (!existing) {
    target.set(key, symbol);
    return;
  }
  for (const source of symbol.sources) {
    if (!existing.sources.includes(source)) existing.sources.push(source);
  }
  if (!existing.name && symbol.name) existing.name = symbol.name;
  if (existing.instrument_type === "stock" && symbol.instrument_type !== "stock") {
    existing.instrument_type = symbol.instrument_type;
  }
}

function collectPositionsArray(payload: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const summary = isRecord(payload.positions_summary) ? payload.positions_summary : undefined;
  const rows = summary && Array.isArray(summary[key]) ? summary[key] : [];
  return rows.filter(isRecord);
}

export function extractPortfolioSymbols(portfolioPayload: unknown, scope: StockPulseMarketScope): StockPulseSymbol[] {
  if (!isRecord(portfolioPayload) || !Array.isArray(portfolioPayload.sources)) return [];
  const out = new Map<string, StockPulseSymbol>();
  for (const source of portfolioPayload.sources.filter(isRecord)) {
    if (source.status !== "ok" || !isRecord(source.payload)) continue;
    const sourceName = str(source.label) ?? str(source.provider) ?? "portfolio";
    const rows = [
      ...collectPositionsArray(source.payload, "top_positions"),
      ...collectPositionsArray(source.payload, "top_gainers"),
      ...collectPositionsArray(source.payload, "top_losers"),
    ];
    for (const row of rows) {
      const code = str(row.code);
      if (!code) continue;
      const normalized = normalizeSymbol({
        symbol: code,
        name: str(row.name),
        instrument_type: str(row.instrument_type) as StockPulseInstrumentType | undefined,
        source: `portfolio:${sourceName}`,
      }, scope);
      if (normalized) mergeSymbol(out, normalized);
    }
  }
  return [...out.values()];
}

export function buildScanUniverse(params: {
  scope: StockPulseMarketScope;
  configured: StockPulseSymbolConfig[];
  portfolio: StockPulseSymbol[];
  universeSourceSymbols: StockPulseUniverseSymbol[];
  includeWatchlist: boolean;
  includePortfolio: boolean;
  includeSources: boolean;
  openMarkets: StockPulseMarket[];
  maxSymbols: number;
}): StockPulseSymbol[] {
  const out = new Map<string, StockPulseSymbol>();
  if (params.includePortfolio) {
    for (const symbol of params.portfolio) mergeSymbol(out, symbol);
  }
  if (params.includeWatchlist) {
    for (const raw of params.configured) {
      const symbol = normalizeSymbol({ ...raw, source: raw.source ?? "watchlist" }, params.scope);
      if (symbol) mergeSymbol(out, symbol);
    }
  }
  if (params.includeSources) {
    for (const raw of params.universeSourceSymbols) {
      const symbol = normalizeSymbol(raw, params.scope);
      if (symbol) mergeSymbol(out, symbol);
    }
  }
  const open = new Set(params.openMarkets);
  return [...out.values()]
    .filter((symbol) => open.has(symbol.market))
    .slice(0, Math.max(0, params.maxSymbols));
}
