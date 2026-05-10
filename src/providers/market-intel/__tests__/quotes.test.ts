import { describe, expect, it } from "vitest";
import { collectMarketIntelMarketSnapshot } from "../quotes.js";
import type {
  MarketIntelProviderConfig,
  MarketIntelQuoteClient,
  MarketIntelQuoteRequest,
  MarketIntelQuoteSnapshotInput,
} from "../types.js";

function testConfig(): MarketIntelProviderConfig {
  return {
    market_scope: "us",
    session: "pre_market",
    timezone: "America/New_York",
    calendar: {
      provider: "static_plus_remote",
      holidays: [],
      early_closes: [],
      fail_on_unknown_trade_date: false,
      skip_closed_market: true,
    },
    markets: {
      us: {
        timezone: "America/New_York",
        sessions: [{ start: "09:30", end: "16:00" }],
        holidays: [],
        early_closes: [],
      },
    },
    sources: {
      quotes: {
        us_primary: "futu_opend",
        fallback: ["yahoo_chart_unofficial"],
        optional_paid: [],
      },
      macro: { federal_reserve: "official_html_rss", treasury: "official_xml_or_fiscaldata", bls: "official_public_api" },
      news: { provider: "official_first_web_fallback", max_items: 40 },
      earnings: { provider: "sec_edgar", max_items: 40 },
      sectors: { provider: "sector_etf" },
    },
    watchlists: {
      indices: ["SPY", "QQQ"],
      sectors: ["XLK", "not_mapped_theme"],
      macro: ["VIX"],
      cross_market: [],
      symbols: [],
    },
    quality: {
      max_stale_minutes: { quote: 20, news: 720, macro: 10080 },
      fail_if_all_quotes_fail: true,
      allow_partial_news: true,
    },
  };
}

describe("collectMarketIntelMarketSnapshot", () => {
  it("collects quote snapshots and marks stale/skipped items", async () => {
    const client: MarketIntelQuoteClient = {
      source: "mock_quotes",
      source_tier: "official",
      async getSnapshot(request: MarketIntelQuoteRequest): Promise<MarketIntelQuoteSnapshotInput> {
        return {
          symbol: request.symbol,
          provider_symbol: request.provider_symbol,
          latest_at: request.symbol === "QQQ" ? "2026-05-08T12:00:00.000Z" : "2026-05-08T12:44:00.000Z",
          latest_price: request.symbol === "SPY" ? 101 : 50,
          previous_close: request.symbol === "SPY" ? 100 : 50,
          currency: "USD",
        };
      },
    };

    const result = await collectMarketIntelMarketSnapshot({
      args: { runAt: new Date("2026-05-08T12:45:00.000Z") },
      config: testConfig(),
      client,
    });

    expect(result.snapshot.indices.status).toBe("ok");
    expect(result.snapshot.indices.items).toHaveLength(2);
    expect(result.snapshot.indices.items.find((item) => item.symbol === "QQQ")?.stale).toBe(true);
    expect(result.snapshot.sectors.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: "not_mapped_theme", skipped: true }),
    ]));
    expect(result.evidence.map((item) => item.id)).toContain("quote.indices.1");
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("QQQ is stale"),
    ]));
  });

  it("fails closed when all mapped quote requests fail and config requires quotes", async () => {
    const client: MarketIntelQuoteClient = {
      source: "mock_quotes",
      source_tier: "official",
      async getSnapshot(_request: MarketIntelQuoteRequest): Promise<MarketIntelQuoteSnapshotInput> {
        throw new Error("quote backend down token=abcdefghijklmnopqrstuvwxyz123456");
      },
    };

    await expect(collectMarketIntelMarketSnapshot({
      args: { runAt: new Date("2026-05-08T12:45:00.000Z") },
      config: testConfig(),
      client,
    })).rejects.toThrow(/token=\[redacted\]/);
  });
});
