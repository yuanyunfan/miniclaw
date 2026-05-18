import { describe, expect, it } from "vitest";
import { __testables, runStockWatchlistResearchProvider } from "../index.js";
import type { MarketIntelProviderConfig } from "../../../stock/data/market-intel-types.js";
import type {
  StockPulseMarketConfig,
  StockPulseProviderConfig,
  StockPulseQuoteBar,
  StockPulseQuoteClient,
  StockPulseQuoteConfig,
  StockPulseQuoteSeries,
  StockPulseSymbol,
  StockPulseUniverseSourceConfig,
  StockPulseUniverseSourceResult,
  StockPulseUniverseSymbol,
} from "../../../stock/data/pulse-types.js";
import type { StockWatchlistResearchClient, StockWatchlistResearchConfig } from "../../../stock/reports/watchlist-research-types.js";

function marketConfig(): StockPulseMarketConfig {
  return {
    timezone: "America/New_York",
    sessions: [{ start: "09:30", end: "16:00" }],
    holidays: [],
  };
}

function providerConfig(): StockWatchlistResearchConfig {
  return {
    market_scope: "us",
    run_type: "pre_market",
    timezone: "America/New_York",
    stock_pulse_config: "us-hourly",
    max_symbols: 10,
    quote: { interval: "5m", range: "60d", include_prepost: true, timeout_ms: 1000, concurrency: 2 },
    research: { enabled: true, news_count_per_symbol: 2, timeout_ms: 1000, concurrency: 2 },
  };
}

function stockPulseConfig(): StockPulseProviderConfig {
  return {
    market_scope: "us",
    portfolio_provider_config: "us-stock",
    active_window: { timezone: "Asia/Shanghai", start: "09:30", end: "01:00" },
    markets: { us: marketConfig() },
    universe: {
      enabled: true,
      include_portfolio: true,
      include_watchlist: true,
      include_sources: true,
      max_symbols: 80,
      symbols: [{ symbol: "SHOULD_NOT_SCAN", market: "us", source: "manual-watchlist" }],
      sources: [
        { type: "futu_watchlist", name: "futu-us-watchlist", market: "us", enabled: true, limit: 10 },
        { type: "eastmoney_myfavor_watchlist", name: "disabled-eastmoney", market: "us", enabled: false, limit: 10 },
        { type: "yahoo_screener", name: "disabled-public-screener", market: "us", enabled: true, limit: 10, scr_id: "day_gainers" },
      ],
    },
    quote: { provider: "yahoo", interval: "5m", range: "60d", include_prepost: false, timeout_ms: 1000, concurrency: 2 },
    thresholds: {
      stock: { hour_abs_pct: 2, day_abs_pct: 4, bar_abs_pct: 0.6, bar_sigma_multiplier: 2, abnormal_bar_count: 3, same_direction_bars: 10, z_score: 2, urgent_z_score: 3 },
      etf: { hour_abs_pct: 1, day_abs_pct: 2, bar_abs_pct: 0.35, bar_sigma_multiplier: 2, abnormal_bar_count: 3, same_direction_bars: 10, z_score: 2, urgent_z_score: 3 },
      leveraged_etf: { hour_abs_pct: 2, day_abs_pct: 4, bar_abs_pct: 0.8, bar_sigma_multiplier: 2, abnormal_bar_count: 3, same_direction_bars: 10, z_score: 2.5, urgent_z_score: 3.5 },
    },
  };
}

function bars(): StockPulseQuoteBar[] {
  const start = Date.parse("2026-05-12T13:30:00.000Z");
  return Array.from({ length: 13 }, (_item, index) => ({
    timestamp: new Date(start + index * 5 * 60 * 1000).toISOString(),
    close: 100 + index,
  }));
}

describe("runStockWatchlistResearchProvider", () => {
  it("collects broker watchlist symbols only and enriches research evidence", async () => {
    const queriedSources: string[] = [];
    const quoteClient: StockPulseQuoteClient = {
      async getBars(symbol: StockPulseSymbol, _config: StockPulseQuoteConfig): Promise<StockPulseQuoteSeries> {
        return {
          symbol: symbol.symbol,
          provider_symbol: symbol.yahoo_symbol,
          market: symbol.market,
          previous_close: 99,
          bars: bars(),
        };
      },
      async getUniverseSymbols(source: StockPulseUniverseSourceConfig): Promise<StockPulseUniverseSymbol[]> {
        queriedSources.push(source.name);
        return [
          { symbol: "AAPL", name: "Apple", market: "us", source: `universe:${source.name}:US` },
          { symbol: "MSFT", name: "Microsoft", market: "us", source: `universe:${source.name}:US` },
        ];
      },
    };
    const researchClient: StockWatchlistResearchClient = {
      async getProfile(symbol) {
        return { symbol: symbol.symbol, provider_symbol: symbol.yahoo_symbol, sector: "Technology", source: "test_profile" };
      },
      async getFinancials() {
        return {
          source: "test_financials",
          status: "ok",
          latest_points: [{ type: "quarterlyTotalRevenue", as_of_date: "2026-03-31", raw: 100, fmt: "100" }],
        };
      },
      async getNews(symbol) {
        return [{ title: `${symbol.symbol} news`, related_tickers: [symbol.symbol] }];
      },
    };

    const result = await runStockWatchlistResearchProvider({
      configName: "us-pre-market",
      jobName: "us-watchlist-stock-pre-market",
      channelId: "channel",
      runAt: new Date("2026-05-12T12:45:00.000Z"),
    }, {
      loadProviderConfig: () => providerConfig(),
      loadStockPulseConfig: () => stockPulseConfig(),
      portfolioRunner: async () => ({
        text: JSON.stringify({
          source: "stock-portfolio",
          sources: [
            {
              provider: "futu-stock",
              config: "us-stock",
              label: "Futu US",
              include_asset_totals: true,
              status: "ok",
              payload: {
                positions_summary: {
                  positions_count: 1,
                  top_positions: [{ code: "MSFT", name: "Microsoft", currency: "USD" }],
                  top_gainers: [],
                  top_losers: [],
                },
              },
            },
            {
              provider: "eastmoney-etf-premium",
              config: "us-stock",
              label: "ETF premium reference",
              include_asset_totals: false,
              status: "ok",
              payload: {
                source: "eastmoney-etf-premium",
                premiums: [],
              },
            },
          ],
        }),
      }),
      quoteClient,
      researchClient,
    });

    const parsed = JSON.parse(result.text);
    expect(queriedSources).toEqual(["futu-us-watchlist"]);
    expect(parsed.source).toBe("stock-watchlist-research");
    expect(parsed.run_context.watchlist_only).toBe(true);
    expect(parsed.watchlist_source.enabled_broker_sources).toBe(1);
    expect(parsed.watchlist_source.fetched_symbols).toBe(2);
    expect(parsed.watchlist_source.raw_watchlist_symbols).toBe(2);
    expect(parsed.watchlist_source.scanned_symbols).toBe(1);
    expect(parsed.watchlist_source.portfolio_filter).toMatchObject({
      status: "applied",
      stock_portfolio_config: "us-stock",
      held_symbols: 1,
      excluded_symbols: 1,
    });
    expect(parsed.watchlist_source.warnings).toEqual([]);
    expect(parsed.symbols.map((item: { symbol: string }) => item.symbol)).toEqual(["AAPL"]);
    expect(parsed.symbols[0].sources).toEqual(["universe:futu-us-watchlist:US"]);
    expect(parsed.symbols[0].portfolio).toBeUndefined();
    expect(parsed.evidence.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([
      "watchlist.quote.1",
      "watchlist.profile.1",
      "watchlist.financials.1",
      "watchlist.news.1.1",
    ]));
    expect(parsed.usage_notes.join("\n")).toContain("watchlist-only");
    expect(parsed.usage_notes.join("\n")).toContain("unowned watchlist symbols");
  });

  it("skips when every broker watchlist symbol is already held", async () => {
    const quoteClient: StockPulseQuoteClient = {
      async getBars(): Promise<StockPulseQuoteSeries> {
        throw new Error("quotes should not be requested");
      },
      async getUniverseSymbols(source: StockPulseUniverseSourceConfig): Promise<StockPulseUniverseSymbol[]> {
        return [
          { symbol: "AAPL", name: "Apple", market: "us", source: `universe:${source.name}:US` },
          { symbol: "MSFT", name: "Microsoft", market: "us", source: `universe:${source.name}:US` },
        ];
      },
    };
    const result = await runStockWatchlistResearchProvider({
      configName: "us-pre-market",
      jobName: "us-watchlist-stock-pre-market",
      channelId: "channel",
      runAt: new Date("2026-05-12T12:45:00.000Z"),
    }, {
      loadProviderConfig: () => providerConfig(),
      loadStockPulseConfig: () => stockPulseConfig(),
      portfolioRunner: async () => ({
        text: JSON.stringify({
          source: "stock-portfolio",
          sources: [
            {
              provider: "futu-stock",
              config: "us-stock",
              label: "Futu US",
              status: "ok",
              payload: {
                positions_summary: {
                  positions_count: 2,
                  top_positions: [
                    { code: "AAPL", name: "Apple", currency: "USD" },
                    { code: "MSFT", name: "Microsoft", currency: "USD" },
                  ],
                  top_gainers: [],
                  top_losers: [],
                },
              },
            },
          ],
        }),
      }),
      quoteClient,
      researchClient: {
        async getProfile() {
          throw new Error("research should not be requested");
        },
        async getFinancials() {
          throw new Error("research should not be requested");
        },
        async getNews() {
          throw new Error("research should not be requested");
        },
      },
    });

    const parsed = JSON.parse(result.text);
    expect(parsed.run_context.skipped).toBe(true);
    expect(parsed.run_context.skip_reason).toBe("empty_unowned_broker_watchlist");
    expect(parsed.watchlist_source.raw_watchlist_symbols).toBe(2);
    expect(parsed.watchlist_source.scanned_symbols).toBe(0);
    expect(parsed.watchlist_source.portfolio_filter.excluded_symbols).toBe(2);
    expect(parsed.symbols).toEqual([]);
  });

  it("keeps true empty broker watchlists separate from source failures", async () => {
    const quoteClient: StockPulseQuoteClient = {
      async getBars(): Promise<StockPulseQuoteSeries> {
        throw new Error("quotes should not be requested");
      },
      async getUniverseSymbolsBatch(sources: StockPulseUniverseSourceConfig[]): Promise<StockPulseUniverseSourceResult[]> {
        return sources.map((source) => ({ source, symbols: [], warnings: [] }));
      },
    };

    const result = await runStockWatchlistResearchProvider({
      configName: "us-pre-market",
      jobName: "us-watchlist-stock-pre-market",
      channelId: "channel",
      runAt: new Date("2026-05-12T12:45:00.000Z"),
    }, {
      loadProviderConfig: () => providerConfig(),
      loadStockPulseConfig: () => stockPulseConfig(),
      portfolioRunner: async () => {
        throw new Error("portfolio should not be requested");
      },
      quoteClient,
      researchClient: {
        async getProfile() {
          throw new Error("research should not be requested");
        },
        async getFinancials() {
          throw new Error("research should not be requested");
        },
        async getNews() {
          throw new Error("research should not be requested");
        },
      },
    });

    const parsed = JSON.parse(result.text);
    expect(parsed.run_context.skipped).toBe(true);
    expect(parsed.run_context.skip_reason).toBe("empty_broker_watchlist");
    expect(parsed.watchlist_source.raw_watchlist_symbols).toBe(0);
    expect(parsed.watchlist_source.warnings).toEqual([]);
    expect(result.skipTask?.reason).toBe("empty_broker_watchlist");
  });

  it("marks broker watchlist source failures as unavailable with warnings", async () => {
    const quoteClient: StockPulseQuoteClient = {
      async getBars(): Promise<StockPulseQuoteSeries> {
        throw new Error("quotes should not be requested");
      },
      async getUniverseSymbolsBatch(sources: StockPulseUniverseSourceConfig[]): Promise<StockPulseUniverseSourceResult[]> {
        return sources.map((source) => ({
          source,
          symbols: [],
          warnings: ["futu watchlist profile default rate-limited: 1/1 group(s) failed; first=All: 获取自选股分组频率太高，请求失败，每30秒最多10次。"],
          error: "futu watchlist profile default unavailable",
          unavailable: true,
        }));
      },
    };

    const result = await runStockWatchlistResearchProvider({
      configName: "us-pre-market",
      jobName: "us-watchlist-stock-pre-market",
      channelId: "channel",
      runAt: new Date("2026-05-12T12:45:00.000Z"),
    }, {
      loadProviderConfig: () => providerConfig(),
      loadStockPulseConfig: () => stockPulseConfig(),
      portfolioRunner: async () => {
        throw new Error("portfolio should not be requested");
      },
      quoteClient,
      researchClient: {
        async getProfile() {
          throw new Error("research should not be requested");
        },
        async getFinancials() {
          throw new Error("research should not be requested");
        },
        async getNews() {
          throw new Error("research should not be requested");
        },
      },
    });

    const parsed = JSON.parse(result.text);
    expect(parsed.run_context.skipped).toBe(true);
    expect(parsed.run_context.skip_reason).toBe("broker_watchlist_unavailable");
    expect(parsed.watchlist_source.raw_watchlist_symbols).toBe(0);
    expect(parsed.watchlist_source.warnings.join("\n")).toContain("rate-limited");
    expect(parsed.watchlist_source.warnings.join("\n")).toContain("频率太高");
    expect(result.skipTask?.reason).toBe("broker_watchlist_unavailable");
  });

  it("strips portfolio config when embedding market-intel context", () => {
    const marketIntelConfig = {
      market_scope: "us",
      session: "pre_market",
      timezone: "America/New_York",
      portfolio_provider_config: "us-stock",
      watchlists: { indices: [], sectors: [], macro: [], cross_market: [], symbols: ["NVDA"] },
    } as unknown as MarketIntelProviderConfig;

    const cloned = __testables.cloneMarketIntelConfig({
      config: providerConfig(),
      marketConfig: marketIntelConfig,
      symbols: [{
        symbol: "AAPL",
        yahoo_symbol: "AAPL",
        market: "us",
        instrument_type: "stock",
        sources: ["universe:futu-us-watchlist:US"],
      }],
    });

    expect(cloned.portfolio_provider_config).toBeUndefined();
    expect(cloned.watchlists.symbols).toEqual(["AAPL"]);
  });
});
