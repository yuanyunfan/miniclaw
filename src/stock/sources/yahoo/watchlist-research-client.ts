import type { StockPulseSymbol } from "../../../providers/stock-pulse/types.js";
import type {
  StockWatchlistFinancialPoint,
  StockWatchlistFinancials,
  StockWatchlistNewsItem,
  StockWatchlistResearchClient,
  StockWatchlistResearchProfile,
} from "../../../providers/stock-watchlist-research/types.js";

const USER_AGENT = "MiniClaw/1.0 stock-watchlist-research";
const FINANCIAL_TYPES = [
  "annualTotalRevenue",
  "annualNetIncome",
  "quarterlyTotalRevenue",
  "quarterlyNetIncome",
  "quarterlyRevenueGrowth",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function fetchJson(url: URL, timeoutMs: number): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json() as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function searchUrl(symbol: StockPulseSymbol, newsCount: number): URL {
  const url = new URL("https://query1.finance.yahoo.com/v1/finance/search");
  url.searchParams.set("q", symbol.yahoo_symbol);
  url.searchParams.set("quotesCount", "1");
  url.searchParams.set("newsCount", String(newsCount));
  return url;
}

function financialUrl(symbol: StockPulseSymbol): URL {
  const now = Math.floor(Date.now() / 1000);
  const period1 = now - 60 * 60 * 24 * 365 * 4;
  const url = new URL(`https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol.yahoo_symbol)}`);
  url.searchParams.set("symbol", symbol.yahoo_symbol);
  url.searchParams.set("type", FINANCIAL_TYPES.join(","));
  url.searchParams.set("merge", "false");
  url.searchParams.set("period1", String(period1));
  url.searchParams.set("period2", String(now));
  return url;
}

function parseProfile(json: unknown, symbol: StockPulseSymbol): StockWatchlistResearchProfile | undefined {
  if (!isRecord(json)) return undefined;
  const quote = array(json.quotes).find(isRecord);
  if (!quote) return undefined;
  return {
    symbol: symbol.symbol,
    provider_symbol: symbol.yahoo_symbol,
    quote_type: str(quote.quoteType) ?? str(quote.typeDisp),
    exchange: str(quote.exchange) ?? str(quote.exchDisp),
    sector: str(quote.sector),
    industry: str(quote.industry),
    long_name: str(quote.longname),
    short_name: str(quote.shortname),
    source: "yahoo_finance_search",
  };
}

function publishedAt(value: unknown): string | undefined {
  const raw = num(value);
  return raw === undefined ? undefined : new Date(raw * 1000).toISOString();
}

function parseNews(json: unknown): StockWatchlistNewsItem[] {
  if (!isRecord(json)) return [];
  return array(json.news).filter(isRecord).map((item): StockWatchlistNewsItem | undefined => {
    const title = str(item.title);
    if (!title) return undefined;
    return {
      title,
      publisher: str(item.publisher),
      published_at: publishedAt(item.providerPublishTime),
      url: str(item.link),
      related_tickers: array(item.relatedTickers).filter((ticker): ticker is string => typeof ticker === "string" && Boolean(ticker.trim())),
    };
  }).filter((item): item is StockWatchlistNewsItem => item !== undefined);
}

function latestPoint(type: string, rows: unknown[]): StockWatchlistFinancialPoint | undefined {
  const latest = rows.filter(isRecord).at(-1);
  if (!latest) return undefined;
  const reported = isRecord(latest.reportedValue) ? latest.reportedValue : {};
  return {
    type,
    as_of_date: str(latest.asOfDate),
    period_type: str(latest.periodType),
    raw: num(reported.raw),
    fmt: str(reported.fmt) ?? (num(reported.raw) !== undefined ? String(num(reported.raw)) : undefined),
  };
}

function parseFinancials(json: unknown): StockWatchlistFinancialPoint[] {
  if (!isRecord(json) || !isRecord(json.timeseries)) return [];
  const result = array(json.timeseries.result).filter(isRecord);
  const points: StockWatchlistFinancialPoint[] = [];
  for (const section of result) {
    for (const type of FINANCIAL_TYPES) {
      const rows = array(section[type]);
      const point = latestPoint(type, rows);
      if (point) points.push(point);
    }
  }
  return points;
}

export class YahooStockWatchlistResearchClient implements StockWatchlistResearchClient {
  async getProfile(symbol: StockPulseSymbol, timeoutMs: number): Promise<StockWatchlistResearchProfile | undefined> {
    return parseProfile(await fetchJson(searchUrl(symbol, 0), timeoutMs), symbol);
  }

  async getNews(symbol: StockPulseSymbol, count: number, timeoutMs: number): Promise<StockWatchlistNewsItem[]> {
    if (count <= 0) return [];
    return parseNews(await fetchJson(searchUrl(symbol, count), timeoutMs));
  }

  async getFinancials(symbol: StockPulseSymbol, timeoutMs: number): Promise<StockWatchlistFinancials> {
    const latestPoints = parseFinancials(await fetchJson(financialUrl(symbol), timeoutMs));
    return {
      source: "yahoo_finance_fundamentals_timeseries",
      status: latestPoints.length ? "ok" : "partial",
      latest_points: latestPoints,
      error: latestPoints.length ? undefined : "No supported fundamentals timeseries points returned.",
    };
  }
}

export const __testables = {
  parseProfile,
  parseNews,
  parseFinancials,
  searchUrl,
  financialUrl,
};
