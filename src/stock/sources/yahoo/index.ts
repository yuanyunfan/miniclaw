import type { StockQuoteBar } from "../../types.js";

export interface YahooChartSeries {
  provider_symbol: string;
  currency?: string;
  previous_close?: number;
  bars: StockQuoteBar[];
  latest_at?: string;
  latest_price?: number;
}

export interface YahooScreenerSymbol {
  symbol: string;
  name?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function fetchYahooJson(url: URL, timeoutMs: number, userAgent: string): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": userAgent },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json() as unknown;
  } finally {
    clearTimeout(timer);
  }
}

export function parseYahooChartSeries(json: unknown, providerSymbol: string): YahooChartSeries {
  if (!isRecord(json) || !isRecord(json.chart) || !Array.isArray(json.chart.result) || !isRecord(json.chart.result[0])) {
    throw new Error(`yahoo chart returned invalid payload for ${providerSymbol}`);
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

  const bars: StockQuoteBar[] = [];
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

  const latest = bars.at(-1);
  const metaPrice = num(meta.regularMarketPrice) ?? num(meta.previousClose);
  return {
    provider_symbol: providerSymbol,
    currency: str(meta.currency),
    previous_close: num(meta.chartPreviousClose) ?? num(meta.previousClose),
    bars,
    latest_at: latest?.timestamp,
    latest_price: latest?.close ?? metaPrice,
  };
}

export async function fetchYahooChartSeries(params: {
  providerSymbol: string;
  range: string;
  interval: string;
  includePrePost: boolean;
  timeoutMs: number;
  userAgent: string;
}): Promise<YahooChartSeries> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(params.providerSymbol)}`);
  url.searchParams.set("range", params.range);
  url.searchParams.set("interval", params.interval);
  url.searchParams.set("includePrePost", params.includePrePost ? "true" : "false");
  url.searchParams.set("events", "div,splits");
  const series = parseYahooChartSeries(await fetchYahooJson(url, params.timeoutMs, params.userAgent), params.providerSymbol);
  if (!series.bars.length) throw new Error(`yahoo chart returned no bars for ${params.providerSymbol}`);
  return series;
}

export function parseYahooScreenerSymbols(json: unknown): YahooScreenerSymbol[] {
  if (!isRecord(json) || !isRecord(json.finance) || !Array.isArray(json.finance.result)) return [];
  const rows = json.finance.result.flatMap((result) => {
    if (!isRecord(result) || !Array.isArray(result.quotes)) return [] as unknown[];
    return result.quotes;
  });
  return rows.filter(isRecord).map((row): YahooScreenerSymbol | undefined => {
    const symbol = str(row.symbol);
    if (!symbol) return undefined;
    return {
      symbol,
      name: str(row.shortName) ?? str(row.longName),
    };
  }).filter((item): item is YahooScreenerSymbol => item !== undefined);
}

export async function fetchYahooScreenerSymbols(params: {
  scrId: string;
  count: number;
  timeoutMs: number;
  userAgent: string;
}): Promise<YahooScreenerSymbol[]> {
  const url = new URL("https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved");
  url.searchParams.set("scrIds", params.scrId);
  url.searchParams.set("count", String(params.count));
  return parseYahooScreenerSymbols(await fetchYahooJson(url, params.timeoutMs, params.userAgent));
}
