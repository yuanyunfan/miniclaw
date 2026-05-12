import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createStockPulseProvider, runStockPulseProvider } from "../index.js";
import type {
  StockPulseProviderConfig,
  StockPulseQuoteClient,
  StockPulseQuoteConfig,
  StockPulseQuoteSeries,
  StockPulseSymbol,
  StockPulseUniverseSourceConfig,
  StockPulseUniverseSymbol,
} from "../types.js";

interface StockPulseReplayFixture {
  runAt: string;
  config: StockPulseProviderConfig;
  portfolioPayload?: unknown;
  universeSymbols?: StockPulseUniverseSymbol[];
  quotes?: Record<string, StockPulseQuoteSeries>;
}

function readFixture(name: string): StockPulseReplayFixture {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as StockPulseReplayFixture;
}

function quoteClient(fixture: StockPulseReplayFixture): StockPulseQuoteClient {
  return {
    async getBars(symbol: StockPulseSymbol, _config: StockPulseQuoteConfig): Promise<StockPulseQuoteSeries> {
      const series = fixture.quotes?.[symbol.symbol];
      if (!series) throw new Error(`token=fixture-token quote missing for ${symbol.symbol}`);
      return series;
    },
    async getUniverseSymbols(_source: StockPulseUniverseSourceConfig): Promise<StockPulseUniverseSymbol[]> {
      return fixture.universeSymbols ?? [];
    },
  };
}

describe("stock-pulse replay fixtures", () => {
  it("replays a market-open scan fixture and keeps dry-run output redacted", async () => {
    const fixture = readFixture("us-hourly-replay.json");
    let committed = false;
    const deps = {
      loadProviderConfig: () => fixture.config,
      quoteClient: quoteClient(fixture),
      portfolioRunner: async () => ({
        text: JSON.stringify(fixture.portfolioPayload),
        commit: async () => {
          committed = true;
        },
      }),
    };
    const context = {
      configName: "us-hourly",
      jobName: "us-stock-hourly-pulse",
      channelId: "channel",
      runAt: new Date(fixture.runAt),
    };

    const dryRun = await createStockPulseProvider(deps).dryRun?.(context);

    expect(dryRun).toMatchObject({
      ok: true,
      redacted: true,
      structured: {
        source: "stock-pulse",
        profile: "us-hourly",
        market_scope: "us",
        position_count: 2,
        alert_count: 1,
        failure_count: 1,
        warning_count: 1,
      },
      warnings: expect.arrayContaining(["NVDA: token=[redacted] quote missing for NVDA"]),
    });
    expect(dryRun?.previewText).not.toContain("AAPL");
    expect(dryRun?.previewText).not.toContain("MSFT");
    expect(dryRun?.previewText).not.toContain("daily_pnl_cny");
    expect(dryRun?.previewText).not.toContain("fixture-token");
    expect(committed).toBe(false);

    const result = await runStockPulseProvider(context, deps);
    const parsed = JSON.parse(result.text);
    expect(parsed.alerts.map((alert: { symbol: string }) => alert.symbol)).toEqual(["AAPL"]);
    expect(parsed.failures[0]).toMatchObject({
      symbol: "NVDA",
      error: "token=[redacted] quote missing for NVDA",
    });
    expect(parsed.positions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        symbol: "AAPL",
        portfolio: expect.objectContaining({
          daily_pnl_cny: 71,
          unrealized_pnl_cny: 355,
        }),
      }),
    ]));
    expect(committed).toBe(false);
    await result.commit?.();
    expect(committed).toBe(true);
  });

  it("replays a closed-market fixture without querying portfolio or quote sources", async () => {
    const fixture = readFixture("closed-market.json");
    let portfolioQueried = false;
    let quotesQueried = false;

    const result = await runStockPulseProvider({
      configName: "us-hourly",
      jobName: "us-stock-hourly-pulse",
      channelId: "channel",
      runAt: new Date(fixture.runAt),
    }, {
      loadProviderConfig: () => fixture.config,
      quoteClient: {
        async getBars(): Promise<StockPulseQuoteSeries> {
          quotesQueried = true;
          throw new Error("quotes should not be queried for a closed market fixture");
        },
      },
      portfolioRunner: async () => {
        portfolioQueried = true;
        return { text: "{}" };
      },
    });

    const parsed = JSON.parse(result.text);
    expect(parsed.run_context).toMatchObject({
      active_window_ok: true,
      open_markets: [],
      skipped: true,
      skip_reason: "no_configured_market_open",
    });
    expect(parsed.universe).toMatchObject({
      configured_symbols: 1,
      scanned_symbols: 0,
      failed_symbols: 0,
    });
    expect(portfolioQueried).toBe(false);
    expect(quotesQueried).toBe(false);
  });
});
