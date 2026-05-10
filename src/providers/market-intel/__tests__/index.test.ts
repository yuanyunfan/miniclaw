import { describe, expect, it } from "vitest";
import { runMarketIntelProvider } from "../index.js";
import type { MarketIntelProviderConfig } from "../types.js";

function testConfig(overrides: Partial<MarketIntelProviderConfig> = {}): MarketIntelProviderConfig {
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
      macro: {
        federal_reserve: "official_html_rss",
        treasury: "official_xml_or_fiscaldata",
        bls: "official_public_api",
      },
      news: { provider: "official_first_web_fallback", max_items: 40 },
      earnings: { provider: "sec_edgar", max_items: 40 },
      sectors: { provider: "sector_etf" },
    },
    watchlists: {
      indices: ["SPY", "QQQ"],
      sectors: ["XLK", "XLF"],
      macro: ["DXY", "VIX"],
      cross_market: [],
      symbols: [],
    },
    quality: {
      max_stale_minutes: { quote: 20, news: 720, macro: 10080 },
      fail_if_all_quotes_fail: true,
      allow_partial_news: true,
    },
    ...overrides,
  };
}

describe("runMarketIntelProvider", () => {
  it("returns a phase-1 pre-market payload", async () => {
    const result = await runMarketIntelProvider({
      configName: "us-pre-market",
      jobName: "us-stock-pre-market",
      channelId: "1000000000000000000",
      runAt: new Date("2026-05-08T12:45:00.000Z"),
    }, {
      loadProviderConfig: () => testConfig(),
    });

    const parsed = JSON.parse(result.text);
    expect(result.skipTask).toBeUndefined();
    expect(parsed.source).toBe("market-intel");
    expect(parsed.profile).toBe("us-pre-market");
    expect(parsed.run_context.calendar_status).toBe("pre_market");
    expect(parsed.role_protocol.roles).toContain("Risk, Scenario & Devil's Advocate");
  });

  it("returns skipTask when all configured markets are closed", async () => {
    const result = await runMarketIntelProvider({
      configName: "us-pre-market",
      jobName: "us-stock-pre-market",
      channelId: "1000000000000000000",
      runAt: new Date("2026-05-09T12:45:00.000Z"),
    }, {
      loadProviderConfig: () => testConfig(),
    });

    const parsed = JSON.parse(result.text);
    expect(result.skipTask?.reason).toBe("market_closed");
    expect(parsed.run_context.skipped).toBe(true);
    expect(parsed.run_context.skip_reason).toBe("market_closed");
    expect(parsed.run_context.calendar_status).toBe("closed");
  });

  it("can keep closed-market payload without skipping when configured", async () => {
    const result = await runMarketIntelProvider({
      configName: "us-pre-market",
      jobName: "us-stock-pre-market",
      channelId: "1000000000000000000",
      runAt: new Date("2026-05-09T12:45:00.000Z"),
    }, {
      loadProviderConfig: () => testConfig({
        calendar: {
          provider: "static_plus_remote",
          holidays: [],
          early_closes: [],
          fail_on_unknown_trade_date: false,
          skip_closed_market: false,
        },
      }),
    });

    const parsed = JSON.parse(result.text);
    expect(result.skipTask).toBeUndefined();
    expect(parsed.run_context.calendar_status).toBe("closed");
    expect(parsed.run_context.skipped).toBe(false);
  });
});
