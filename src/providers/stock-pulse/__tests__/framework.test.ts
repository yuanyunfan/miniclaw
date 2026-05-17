import { describe, expect, it } from "vitest";
import { createStockPulseProvider } from "../index.js";
import type {
  StockPulseProviderConfig,
  StockPulseQuoteBar,
  StockPulseQuoteClient,
  StockPulseQuoteConfig,
  StockPulseQuoteSeries,
  StockPulseSymbol,
} from "../../../stock/data/pulse-types.js";

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
      include_sources: false,
      max_symbols: 5,
      symbols: [{ symbol: "MSFT", market: "us", source: "watchlist" }],
      sources: [],
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
  const start = Date.parse("2026-05-08T13:30:00.000Z");
  return Array.from({ length: 30 }, (_, i) => ({
    timestamp: new Date(start + i * 5 * 60 * 1000).toISOString(),
    close: 100 + i / 100,
  }));
}

const quoteClient: StockPulseQuoteClient = {
  async getBars(symbol: StockPulseSymbol, _config: StockPulseQuoteConfig): Promise<StockPulseQuoteSeries> {
    return {
      symbol: symbol.symbol,
      provider_symbol: symbol.yahoo_symbol,
      market: symbol.market,
      previous_close: 100,
      bars: bars(),
    };
  },
};

describe("stock-pulse provider framework pilot", () => {
  it("health-checks config without collecting portfolio or quotes", async () => {
    let portfolioQueried = false;
    let quotesQueried = false;
    const provider = createStockPulseProvider({
      loadProviderConfig: () => testConfig(),
      portfolioRunner: async () => {
        portfolioQueried = true;
        return { text: "{}" };
      },
      quoteClient: {
        async getBars(symbol, config) {
          quotesQueried = true;
          return await quoteClient.getBars(symbol, config);
        },
      },
    });

    const health = await provider.healthCheck?.({
      configName: "us-hourly",
      jobName: "us-stock-hourly-pulse",
      channelId: "channel",
      runAt: new Date("2026-05-08T14:30:00.000Z"),
    });

    expect(health).toMatchObject({
      ok: true,
      message: "stock-pulse config us-hourly is loadable",
      safeDetails: {
        profile: "us-hourly",
        market_scope: "us",
        configured_symbols: 1,
        include_portfolio: true,
        include_sources: false,
      },
    });
    expect(portfolioQueried).toBe(false);
    expect(quotesQueried).toBe(false);
  });

  it("dry-runs with a redacted summary and does not commit nested provider state", async () => {
    let committed = false;
    const provider = createStockPulseProvider({
      loadProviderConfig: () => testConfig(),
      quoteClient,
      portfolioRunner: async () => ({
        text: JSON.stringify({
          cny_summary: { fx_rates: { USD: 7.1 } },
          sources: [{
            status: "ok",
            provider: "futu-stock",
            label: "Futu US",
            payload: {
              positions_summary: {
                top_positions: [
                  { code: "AAPL", name: "Apple", currency: "USD", instrument_type: "stock", daily_pnl: 10, pnl_value: 50, pnl_ratio: 1.25 },
                ],
                top_gainers: [],
                top_losers: [],
              },
            },
          }],
        }),
        commit: async () => {
          committed = true;
        },
      }),
    });

    const result = await provider.dryRun?.({
      configName: "us-hourly",
      jobName: "us-stock-hourly-pulse",
      channelId: "channel",
      runAt: new Date("2026-05-08T14:30:00.000Z"),
    });

    expect(result).toMatchObject({
      ok: true,
      redacted: true,
      structured: {
        source: "stock-pulse",
        profile: "us-hourly",
        market_scope: "us",
        position_count: 2,
        failure_count: 0,
        warning_count: 0,
      },
    });
    expect(result?.previewText).not.toContain("daily_pnl_cny");
    expect(result?.previewText).not.toContain("AAPL");
    expect(committed).toBe(false);
  });
});
