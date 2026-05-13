import type {
  StockPulseQuoteBar,
  StockPulseQuoteClient,
  StockPulseQuoteConfig,
  StockPulseQuoteSeries,
  StockPulseSymbol,
  StockPulseUniverseSourceConfig,
  StockPulseUniverseSymbol,
} from "./types.js";
import {
  getEastmoneyMyfavorUniverseSymbols,
  getFutuWatchlistUniverseSymbols,
} from "./watchlist-sources.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function fetchJson(url: URL, timeoutMs: number): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": "MiniClaw/0.4 stock-pulse" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json() as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function parseChart(json: unknown, symbol: StockPulseSymbol): StockPulseQuoteSeries {
  if (!isRecord(json) || !isRecord(json.chart) || !Array.isArray(json.chart.result) || !isRecord(json.chart.result[0])) {
    throw new Error(`yahoo chart returned invalid payload for ${symbol.yahoo_symbol}`);
  }
  const result = json.chart.result[0];
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const indicators = isRecord(result.indicators) ? result.indicators : {};
  const quote = Array.isArray(indicators.quote) && isRecord(indicators.quote[0]) ? indicators.quote[0] : {};
  const meta = isRecord(result.meta) ? result.meta : {};
  const opens = Array.isArray(quote.open) ? quote.open : [];
  const highs = Array.isArray(quote.high) ? quote.high : [];
  const lows = Array.isArray(quote.low) ? quote.low : [];
  const closes = Array.isArray(quote.close) ? quote.close : [];
  const volumes = Array.isArray(quote.volume) ? quote.volume : [];

  const bars: StockPulseQuoteBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = num(timestamps[i]);
    const close = num(closes[i]);
    if (ts === undefined || close === undefined) continue;
    bars.push({
      timestamp: new Date(ts * 1000).toISOString(),
      open: num(opens[i]),
      high: num(highs[i]),
      low: num(lows[i]),
      close,
      volume: num(volumes[i]),
    });
  }

  if (!bars.length) throw new Error(`yahoo chart returned no bars for ${symbol.yahoo_symbol}`);
  return {
    symbol: symbol.symbol,
    provider_symbol: symbol.yahoo_symbol,
    market: symbol.market,
    currency: str(meta.currency),
    previous_close: num(meta.chartPreviousClose) ?? num(meta.previousClose),
    bars,
  };
}

function parseYahooScreener(json: unknown, source: StockPulseUniverseSourceConfig): StockPulseUniverseSymbol[] {
  if (!isRecord(json) || !isRecord(json.finance) || !Array.isArray(json.finance.result)) return [];
  const rows = json.finance.result.flatMap((result) => {
    if (!isRecord(result) || !Array.isArray(result.quotes)) return [] as unknown[];
    return result.quotes;
  });
  return rows.filter(isRecord).map((row): StockPulseUniverseSymbol | undefined => {
    const symbol = str(row.symbol);
    if (!symbol) return undefined;
    return {
      symbol,
      yahoo_symbol: symbol,
      name: str(row.shortName) ?? str(row.longName),
      market: source.market,
      source: `universe:${source.name}`,
    };
  }).filter((item): item is StockPulseUniverseSymbol => item !== undefined).slice(0, source.limit);
}

function parseEastmoneyClist(json: unknown, source: StockPulseUniverseSourceConfig): StockPulseUniverseSymbol[] {
  if (!isRecord(json) || !isRecord(json.data) || !Array.isArray(json.data.diff)) return [];
  return json.data.diff.filter(isRecord).map((row): StockPulseUniverseSymbol | undefined => {
    const code = str(row.f12);
    if (!code) return undefined;
    return {
      symbol: code,
      name: str(row.f14),
      market: source.market,
      source: `universe:${source.name}`,
    };
  }).filter((item): item is StockPulseUniverseSymbol => item !== undefined).slice(0, source.limit);
}

export class YahooStockPulseQuoteClient implements StockPulseQuoteClient {
  async getBars(symbol: StockPulseSymbol, config: StockPulseQuoteConfig): Promise<StockPulseQuoteSeries> {
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.yahoo_symbol)}`);
    url.searchParams.set("range", config.range);
    url.searchParams.set("interval", config.interval);
    url.searchParams.set("includePrePost", config.include_prepost ? "true" : "false");
    url.searchParams.set("events", "div,splits");
    return parseChart(await fetchJson(url, config.timeout_ms), symbol);
  }

  async getUniverseSymbols(source: StockPulseUniverseSourceConfig): Promise<StockPulseUniverseSymbol[]> {
    if (source.type === "yahoo_screener") {
      const url = new URL("https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved");
      url.searchParams.set("scrIds", source.scr_id ?? "");
      url.searchParams.set("count", String(source.limit));
      return parseYahooScreener(await fetchJson(url, 8000), source);
    }
    if (source.type === "futu_watchlist") {
      return getFutuWatchlistUniverseSymbols(source);
    }
    if (source.type === "eastmoney_myfavor_watchlist") {
      return getEastmoneyMyfavorUniverseSymbols(source);
    }
    const url = new URL("https://push2.eastmoney.com/api/qt/clist/get");
    url.searchParams.set("pn", "1");
    url.searchParams.set("pz", String(source.limit));
    url.searchParams.set("po", "1");
    url.searchParams.set("np", "1");
    url.searchParams.set("fltt", "2");
    url.searchParams.set("invt", "2");
    url.searchParams.set("fs", source.fs ?? "");
    url.searchParams.set("fields", "f12,f14,f2,f3,f4,f5,f6,f17,f18,f20,f21");
    return parseEastmoneyClist(await fetchJson(url, 8000), source);
  }
}
