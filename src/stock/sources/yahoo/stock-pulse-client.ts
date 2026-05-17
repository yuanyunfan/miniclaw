import type {
  StockPulseQuoteClient,
  StockPulseQuoteConfig,
  StockPulseQuoteSeries,
  StockPulseSymbol,
  StockPulseUniverseSourceConfig,
  StockPulseUniverseSymbol,
} from "../../../providers/stock-pulse/types.js";
import {
  getEastmoneyMyfavorUniverseSymbols,
  getFutuWatchlistUniverseSymbols,
} from "../../data/universe.js";
import {
  fetchYahooChartSeries,
  fetchYahooJson,
  fetchYahooScreenerSymbols,
} from "./index.js";

const USER_AGENT = "MiniClaw/0.4 stock-pulse";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

async function fetchEastmoneyClist(source: StockPulseUniverseSourceConfig): Promise<StockPulseUniverseSymbol[]> {
  const url = new URL("https://push2.eastmoney.com/api/qt/clist/get");
  url.searchParams.set("pn", "1");
  url.searchParams.set("pz", String(source.limit));
  url.searchParams.set("po", "1");
  url.searchParams.set("np", "1");
  url.searchParams.set("fltt", "2");
  url.searchParams.set("invt", "2");
  url.searchParams.set("fs", source.fs ?? "");
  url.searchParams.set("fields", "f12,f14,f2,f3,f4,f5,f6,f17,f18,f20,f21");
  return parseEastmoneyClist(await fetchYahooJson(url, 8000, USER_AGENT), source);
}

export class YahooStockPulseQuoteClient implements StockPulseQuoteClient {
  async getBars(symbol: StockPulseSymbol, config: StockPulseQuoteConfig): Promise<StockPulseQuoteSeries> {
    const series = await fetchYahooChartSeries({
      providerSymbol: symbol.yahoo_symbol,
      range: config.range,
      interval: config.interval,
      includePrePost: config.include_prepost,
      timeoutMs: config.timeout_ms,
      userAgent: USER_AGENT,
    });
    return {
      symbol: symbol.symbol,
      provider_symbol: symbol.yahoo_symbol,
      market: symbol.market,
      currency: series.currency,
      previous_close: series.previous_close,
      bars: series.bars,
    };
  }

  async getUniverseSymbols(source: StockPulseUniverseSourceConfig): Promise<StockPulseUniverseSymbol[]> {
    if (source.type === "yahoo_screener") {
      const symbols = await fetchYahooScreenerSymbols({
        scrId: source.scr_id ?? "",
        count: source.limit,
        timeoutMs: 8000,
        userAgent: USER_AGENT,
      });
      return symbols.map((item) => ({
        symbol: item.symbol,
        yahoo_symbol: item.symbol,
        name: item.name,
        market: source.market,
        source: `universe:${source.name}`,
      })).slice(0, source.limit);
    }
    if (source.type === "futu_watchlist") {
      return getFutuWatchlistUniverseSymbols(source);
    }
    if (source.type === "eastmoney_myfavor_watchlist") {
      return getEastmoneyMyfavorUniverseSymbols(source);
    }
    return fetchEastmoneyClist(source);
  }
}
