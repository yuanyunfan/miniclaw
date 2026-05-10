import { describe, expect, it } from "vitest";
import { buildMarketIntelCalendarSnapshot } from "../calendar.js";
import { buildMarketIntelPayload, formatMarketIntelPayload, sanitizeMarketIntelError } from "../format.js";
import { buildPortfolioContextFromText } from "../portfolio.js";
import type { MarketIntelProviderConfig } from "../types.js";

function testConfig(): MarketIntelProviderConfig {
  return {
    market_scope: "us",
    session: "pre_market",
    timezone: "America/New_York",
    portfolio_provider_config: "us-stock",
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
      sectors: ["XLK"],
      macro: ["DXY", "VIX"],
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

describe("market-intel formatting", () => {
  it("builds a structured phase-1 payload", () => {
    const config = testConfig();
    const calendar = buildMarketIntelCalendarSnapshot({
      date: new Date("2026-05-08T12:45:00.000Z"),
      timezone: config.timezone,
      markets: config.markets,
    });
    const payload = buildMarketIntelPayload({
      args: {
        configName: "us-pre-market",
        jobName: "us-stock-pre-market",
        channelId: "1000000000000000000",
        runAt: new Date("2026-05-08T12:45:00.000Z"),
      },
      configName: "us-pre-market",
      config,
      calendar,
      portfolioContext: buildPortfolioContextFromText(JSON.stringify({
        generated_at: "2026-05-08T12:45:00.000Z",
        source: "stock-portfolio",
        profile: "us-stock",
        ok_count: 1,
        failed_count: 0,
        cny_summary: {
          base_currency: "CNY",
          fx_rates: { USD: 7.1 },
          gross_profit_cny: 100,
          gross_loss_cny: -20,
          net_pnl_cny: 80,
          winners_count: 1,
          losers_count: 1,
          flat_count: 0,
          positions_with_pnl_count: 2,
          by_currency: [],
          top_gainers: [],
          top_losers: [],
          warnings: [],
        },
        warnings: [],
        usage_notes: ["portfolio note"],
        sources: [{ provider: "futu-stock", config: "us-stock", status: "ok" }],
      }), "us-stock"),
    });

    expect(payload.run_context.calendar_status).toBe("pre_market");
    expect(payload.data_quality.status).toBe("partial");
    expect(payload.market_snapshot.indices.status).toBe("not_implemented");
    expect(payload.portfolio_context.status).toBe("ok");
    expect(payload.portfolio_context.cny_summary?.net_pnl_cny).toBe(80);
    expect(payload.evidence.map((item) => item.id)).toContain("portfolio.stock-portfolio.1");
    expect(payload.evidence[0]?.id).toBe("calendar.static.1");
    expect(payload.scores.index_direction.direction).toBe("insufficient_data");
  });

  it("redacts sensitive strings before serializing", () => {
    const redacted = sanitizeMarketIntelError("token=abcdefghijklmnopqrstuvwxyz123456 account_id=ABC123");
    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(redacted).toContain("token=[redacted]");
    expect(redacted).toContain("account_id=[redacted]");

    const config = testConfig();
    const calendar = buildMarketIntelCalendarSnapshot({
      date: new Date("2026-05-08T12:45:00.000Z"),
      timezone: config.timezone,
      markets: config.markets,
    });
    const payload = buildMarketIntelPayload({
      args: {
        jobName: "us-stock-pre-market",
        channelId: "1000000000000000000",
        runAt: new Date("2026-05-08T12:45:00.000Z"),
      },
      configName: "us-pre-market",
      config,
      calendar,
    });
    const first = payload.evidence[0];
    expect(first).toBeDefined();
    if (!first) return;
    payload.evidence[0] = {
      ...first,
      summary: "session=abcdefghijklmnopqrstuvwxyz1234567890",
    };

    expect(formatMarketIntelPayload(payload)).not.toContain("abcdefghijklmnopqrstuvwxyz1234567890");
  });
});
