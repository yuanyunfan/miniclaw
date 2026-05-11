import { describe, expect, it } from "vitest";
import { runStockPulseProvider } from "../index.js";
import type {
  StockPulseProviderConfig,
  StockPulseQuoteBar,
  StockPulseQuoteClient,
  StockPulseQuoteConfig,
  StockPulseQuoteSeries,
  StockPulseSymbol,
  StockPulseUniverseSourceConfig,
  StockPulseUniverseSymbol,
} from "../types.js";

function testConfig(): StockPulseProviderConfig {
  return {
    market_scope: "us",
    portfolio_provider_config: "us-stock",
    active_window: { timezone: "Asia/Shanghai", start: "09:30", end: "01:00" },
    markets: {
      us: {
        timezone: "America/New_York",
        sessions: [{ start: "09:30", end: "16:00" }],
        holidays: [],
      },
    },
    universe: {
      enabled: true,
      include_portfolio: true,
      include_watchlist: true,
      include_sources: true,
      max_symbols: 10,
      symbols: [{ symbol: "MSFT", market: "us", source: "watchlist" }],
      sources: [{ type: "yahoo_screener", name: "mock-gainers", market: "us", enabled: true, limit: 5, scr_id: "day_gainers" }],
    },
    quote: { provider: "yahoo", interval: "5m", range: "60d", include_prepost: false, timeout_ms: 1000, concurrency: 2 },
    thresholds: {
      stock: { hour_abs_pct: 2, day_abs_pct: 4, bar_abs_pct: 0.6, bar_sigma_multiplier: 2, abnormal_bar_count: 3, same_direction_bars: 10, z_score: 2, urgent_z_score: 3 },
      etf: { hour_abs_pct: 1, day_abs_pct: 2, bar_abs_pct: 0.35, bar_sigma_multiplier: 2, abnormal_bar_count: 3, same_direction_bars: 10, z_score: 2, urgent_z_score: 3 },
      leveraged_etf: { hour_abs_pct: 2, day_abs_pct: 4, bar_abs_pct: 0.8, bar_sigma_multiplier: 2, abnormal_bar_count: 3, same_direction_bars: 10, z_score: 2.5, urgent_z_score: 3.5 },
    },
  };
}

function bars(symbol: string): StockPulseQuoteBar[] {
  const start = Date.parse("2026-05-08T13:30:00.000Z");
  const out: StockPulseQuoteBar[] = [];
  let price = symbol === "AAPL" ? 100 : 200;
  for (let i = 0; i < 90; i++) {
    price *= symbol === "AAPL" && i >= 78 ? 1.007 : 1.0001;
    out.push({ timestamp: new Date(start + i * 5 * 60 * 1000).toISOString(), close: Math.round(price * 100) / 100 });
  }
  return out;
}

const quoteClient: StockPulseQuoteClient = {
  async getBars(symbol: StockPulseSymbol, _config: StockPulseQuoteConfig): Promise<StockPulseQuoteSeries> {
    return {
      symbol: symbol.symbol,
      provider_symbol: symbol.yahoo_symbol,
      market: symbol.market,
      previous_close: symbol.symbol === "AAPL" ? 100 : 200,
      bars: bars(symbol.symbol),
    };
  },
  async getUniverseSymbols(_source: StockPulseUniverseSourceConfig): Promise<StockPulseUniverseSymbol[]> {
    return [{ symbol: "NVDA", market: "us", source: "universe:mock-gainers" }];
  },
};

describe("runStockPulseProvider", () => {
  it("scans portfolio, watchlist, and universe sources and returns alerts", async () => {
    let committed = false;
    const result = await runStockPulseProvider({
      configName: "us-hourly",
      jobName: "us-stock-hourly-pulse",
      channelId: "channel",
      runAt: new Date("2026-05-08T14:30:00.000Z"),
    }, {
      loadProviderConfig: () => testConfig(),
      quoteClient,
      portfolioRunner: async () => ({
        text: JSON.stringify({
          cny_summary: {
            fx_rates: { USD: 7.1 },
          },
          sources: [
            {
              status: "ok",
              provider: "futu-stock",
              label: "Futu US",
              payload: {
                positions_summary: {
                  top_positions: [
                    { code: "AAPL", name: "Apple", currency: "USD", instrument_type: "stock", daily_pnl: 10, pnl_value: 50, pnl_ratio: 1.25 },
                    { code: "TSLA", name: "Tesla", currency: "USD", instrument_type: "stock", daily_pnl: 30, pnl_value: 5, pnl_ratio: 0.5 },
                    { code: "META", name: "Meta", currency: "USD", instrument_type: "stock", daily_pnl: -20, pnl_value: 100, pnl_ratio: 2.1 },
                    { code: "AMZN", name: "Amazon", currency: "USD", instrument_type: "stock", daily_pnl: -5, pnl_value: -200, pnl_ratio: -3.4 },
                  ],
                  top_gainers: [],
                  top_losers: [],
                },
              },
            },
          ],
        }),
        commit: async () => { committed = true; },
      }),
    });

    const parsed = JSON.parse(result.text);
    expect(parsed.run_context.skipped).toBe(false);
    expect(parsed.universe.portfolio_symbols).toBe(4);
    expect(parsed.universe.universe_source_symbols).toBe(1);
    expect(parsed.universe.scanned_symbols).toBe(6);
    expect(parsed.positions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        symbol: "AAPL",
        yahoo_symbol: "AAPL",
        latest_price: expect.any(Number),
        day_return_pct: expect.any(Number),
        portfolio: expect.objectContaining({
          source_currency: "USD",
          daily_pnl_cny: 71,
          unrealized_pnl_cny: 355,
          pnl_ratio: 1.25,
        }),
      }),
    ]));
    expect(parsed.position_groups.profitable[0]).toMatchObject({
      symbol: "TSLA",
      portfolio: expect.objectContaining({ daily_pnl_cny: 213, unrealized_pnl_cny: 35.5 }),
    });
    expect(parsed.position_groups.profitable[1]).toMatchObject({
      symbol: "AAPL",
      portfolio: expect.objectContaining({ daily_pnl_cny: 71, unrealized_pnl_cny: 355 }),
    });
    expect(parsed.position_groups.losing.map((position: { symbol: string }) => position.symbol)).toEqual(["META", "AMZN"]);
    expect(parsed.position_groups.losing[0].portfolio).toMatchObject({ daily_pnl_cny: -142, unrealized_pnl_cny: 710 });
    expect(parsed.position_groups.losing[1].portfolio).toMatchObject({ daily_pnl_cny: -35.5, unrealized_pnl_cny: -1420 });
    expect(parsed.alerts.map((alert: { symbol: string }) => alert.symbol)).toContain("AAPL");
    await result.commit?.();
    expect(committed).toBe(true);
  });

  it("skips outside the active window before querying portfolio or quotes", async () => {
    let queried = false;
    const result = await runStockPulseProvider({
      configName: "us-hourly",
      jobName: "us-stock-hourly-pulse",
      channelId: "channel",
      runAt: new Date("2026-05-08T18:00:00.000Z"),
    }, {
      loadProviderConfig: () => testConfig(),
      quoteClient,
      portfolioRunner: async () => {
        queried = true;
        return { text: "{}" };
      },
    });

    const parsed = JSON.parse(result.text);
    expect(parsed.run_context.skipped).toBe(true);
    expect(parsed.run_context.skip_reason).toBe("outside_user_active_window");
    expect(queried).toBe(false);
  });
});
