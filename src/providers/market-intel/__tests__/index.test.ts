import { describe, expect, it } from "vitest";
import { buildEmptyMarketIntelEvidenceCollection } from "../../../stock/sources/official/collectors/official.js";
import { runMarketIntelProvider } from "../index.js";
import type { MarketIntelProviderConfig, MarketIntelQuoteClient, MarketIntelQuoteRequest, MarketIntelQuoteSnapshotInput } from "../types.js";

const quoteClient: MarketIntelQuoteClient = {
  source: "mock_quotes",
  source_tier: "official",
  async getSnapshot(request: MarketIntelQuoteRequest): Promise<MarketIntelQuoteSnapshotInput> {
    return {
      symbol: request.symbol,
      provider_symbol: request.provider_symbol,
      latest_at: "2026-05-08T12:44:00.000Z",
      latest_price: request.bucket === "indices" ? 101 : 50,
      previous_close: request.bucket === "indices" ? 100 : 50,
      currency: "USD",
    };
  },
};
const evidenceCollector = async () => buildEmptyMarketIntelEvidenceCollection();

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
      quoteClient,
      evidenceCollector,
    });

    const parsed = JSON.parse(result.text);
    expect(result.skipTask).toBeUndefined();
    expect(parsed.source).toBe("market-intel");
    expect(parsed.profile).toBe("us-pre-market");
    expect(parsed.run_context.calendar_status).toBe("pre_market");
    expect(parsed.market_snapshot.indices.items).toHaveLength(2);
    expect(parsed.evidence.map((item: { id: string }) => item.id)).toContain("quote.indices.1");
    expect(parsed.scores.index_direction.direction).toBe("bullish");
    expect(parsed.role_protocol.roles).toContain("Risk, Scenario & Devil's Advocate");
  });

  it("includes stock-portfolio context and defers commit", async () => {
    let calledConfig: string | undefined;
    let committed = false;
    const result = await runMarketIntelProvider({
      configName: "us-pre-market",
      jobName: "us-stock-pre-market",
      channelId: "1000000000000000000",
      runAt: new Date("2026-05-08T12:45:00.000Z"),
    }, {
      loadProviderConfig: () => testConfig({ portfolio_provider_config: "us-stock" }),
      quoteClient,
      evidenceCollector,
      portfolioRunner: async (args) => {
        calledConfig = args.configName;
        return {
          text: JSON.stringify({
            generated_at: "2026-05-08T12:45:00.000Z",
            source: "stock-portfolio",
            profile: "us-stock",
            ok_count: 1,
            failed_count: 1,
            cny_summary: {
              base_currency: "CNY",
              fx_rates: { USD: 7.1 },
              gross_profit_cny: 100,
              gross_loss_cny: -30,
              net_pnl_cny: 70,
              winners_count: 1,
              losers_count: 1,
              flat_count: 0,
              positions_with_pnl_count: 2,
              by_currency: [],
              top_gainers: [],
              top_losers: [],
              warnings: [],
            },
            warnings: ["futu-stock/cn: unavailable account_id=ABC123"],
            usage_notes: ["portfolio note"],
            sources: [
              { provider: "futu-stock", config: "us-stock", status: "ok" },
              { provider: "eastmoney-jywg-readonly", config: "cn-stock", status: "error", error: "unavailable" },
            ],
          }),
          commit: async () => { committed = true; },
        };
      },
    });

    const parsed = JSON.parse(result.text);
    expect(calledConfig).toBe("us-stock");
    expect(parsed.portfolio_context.status).toBe("partial");
    expect(parsed.portfolio_context.cny_summary.net_pnl_cny).toBe(70);
    expect(parsed.portfolio_context.sources).toHaveLength(2);
    expect(parsed.data_quality.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "portfolio.stock-portfolio", status: "partial" }),
    ]));
    expect(parsed.evidence.map((item: { id: string }) => item.id)).toContain("portfolio.stock-portfolio.1");
    expect(result.text).not.toContain("account_id=ABC123");
    await result.commit?.();
    expect(committed).toBe(true);
  });

  it("fails closed when stock-portfolio fails", async () => {
    await expect(runMarketIntelProvider({
      configName: "us-pre-market",
      jobName: "us-stock-pre-market",
      channelId: "1000000000000000000",
      runAt: new Date("2026-05-08T12:45:00.000Z"),
    }, {
      loadProviderConfig: () => testConfig({ portfolio_provider_config: "us-stock" }),
      evidenceCollector,
      portfolioRunner: async () => {
        throw new Error("broker token=abcdefghijklmnopqrstuvwxyz123456");
      },
    })).rejects.toThrow(/token=\[redacted\]/);
  });

  it("returns skipTask when all configured markets are closed", async () => {
    const result = await runMarketIntelProvider({
      configName: "us-pre-market",
      jobName: "us-stock-pre-market",
      channelId: "1000000000000000000",
      runAt: new Date("2026-05-09T12:45:00.000Z"),
    }, {
      loadProviderConfig: () => testConfig(),
      evidenceCollector,
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
      quoteClient,
      evidenceCollector,
    });

    const parsed = JSON.parse(result.text);
    expect(result.skipTask).toBeUndefined();
    expect(parsed.run_context.calendar_status).toBe("closed");
    expect(parsed.run_context.skipped).toBe(false);
  });
});
