import { beforeEach, describe, expect, it, vi } from "vitest";
import { runStockPortfolioProvider } from "../index.js";
import type { StockPortfolioProviderConfig, StockPortfolioSourceRunner } from "../types.js";

const mocks = vi.hoisted(() => ({
  renderAssetPieChartPng: vi.fn(),
}));

vi.mock("../pie-chart.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../pie-chart.js")>();
  return {
    ...actual,
    renderAssetPieChartPng: mocks.renderAssetPieChartPng,
  };
});

const config: StockPortfolioProviderConfig = {
  continue_on_error: true,
  fail_if_all_sources_fail: true,
  market_scope: "all",
  base_currency: "CNY",
  fx_rates: { CNY: 1, HKD: 0.92 },
  top_movers_limit: 5,
  include_cny_summary: true,
  include_asset_summary: false,
  include_asset_pie_chart: false,
  sources: [
    { provider: "futu-stock", config: "daily-stock-market", label: "Futu", enabled: true, required: false, include_asset_totals: true },
    { provider: "eastmoney-jywg-readonly", config: "daily-stock-market", label: "Eastmoney", enabled: true, required: false, include_asset_totals: true },
  ],
};

describe("runStockPortfolioProvider", () => {
  beforeEach(() => {
    mocks.renderAssetPieChartPng.mockReset();
    mocks.renderAssetPieChartPng.mockResolvedValue("/tmp/asset-pie.png");
  });

  it("aggregates successful source payloads and commits nested providers", async () => {
    let committed = false;
    const runners: Record<string, StockPortfolioSourceRunner> = {
      "futu-stock": async () => ({ text: JSON.stringify({ source: "futu-opend-readonly", account_alias: "Futu" }) }),
      "eastmoney-jywg-readonly": async () => ({
        text: JSON.stringify({ source: "eastmoney-jywg-readonly", account_alias: "Eastmoney" }),
        commit: async () => { committed = true; },
      }),
    };

    const result = await runStockPortfolioProvider({
      configName: "daily-stock-market",
      jobName: "stock-market-premarket",
      channelId: "channel",
      runAt: new Date("2026-05-08T01:15:00.000Z"),
    }, {
      loadProviderConfig: () => config,
      runners,
    });

    const parsed = JSON.parse(result.text);

    expect(parsed.ok_count).toBe(2);
    expect(parsed.sources.map((source: { status: string }) => source.status)).toEqual(["ok", "ok"]);
    await result.commit?.();
    expect(committed).toBe(true);
  });

  it("keeps partial data when a non-required source fails", async () => {
    const runners: Record<string, StockPortfolioSourceRunner> = {
      "futu-stock": async () => ({ text: JSON.stringify({ source: "futu-opend-readonly" }) }),
      "eastmoney-jywg-readonly": async () => {
        throw new Error("validatekey=abcabcabcabcabcabcabcabcabcabc failed");
      },
    };

    const result = await runStockPortfolioProvider({
      configName: "daily-stock-market",
      jobName: "stock-market-premarket",
      channelId: "channel",
      runAt: new Date("2026-05-08T01:15:00.000Z"),
    }, {
      loadProviderConfig: () => config,
      runners,
    });

    const parsed = JSON.parse(result.text);

    expect(parsed.ok_count).toBe(1);
    expect(parsed.failed_count).toBe(1);
    expect(parsed.warnings[0]).toContain("validatekey=[redacted]");
  });

  it("fails when all sources fail", async () => {
    const runners: Record<string, StockPortfolioSourceRunner> = {
      "futu-stock": async () => { throw new Error("cookie=abcabcabcabcabcabcabcabcabcabc"); },
      "eastmoney-jywg-readonly": async () => { throw new Error("token=abcabcabcabcabcabcabcabcabcabc"); },
    };

    await expect(runStockPortfolioProvider({
      configName: "daily-stock-market",
      jobName: "stock-market-premarket",
      channelId: "channel",
      runAt: new Date("2026-05-08T01:15:00.000Z"),
    }, {
      loadProviderConfig: () => config,
      runners,
    })).rejects.toThrow(/all sources failed/);
  });

  it("fails fast for a required source that returns invalid JSON", async () => {
    const runners: Record<string, StockPortfolioSourceRunner> = {
      "futu-stock": async () => ({ text: "[]" }),
    };

    await expect(runStockPortfolioProvider({
      configName: "daily-stock-market",
      jobName: "stock-market-premarket",
      channelId: "channel",
      runAt: new Date("2026-05-08T01:15:00.000Z"),
    }, {
      loadProviderConfig: () => ({
        ...config,
        sources: [
          { provider: "futu-stock", config: "daily-stock-market", enabled: true, required: true, include_asset_totals: true },
        ],
      }),
      runners,
    })).rejects.toThrow(/returned invalid JSON/);
  });

  it("throws when a configured source runner is missing", async () => {
    await expect(runStockPortfolioProvider({
      configName: "daily-stock-market",
      jobName: "stock-market-premarket",
      channelId: "channel",
      runAt: new Date("2026-05-08T01:15:00.000Z"),
    }, {
      loadProviderConfig: () => ({
        ...config,
        sources: [
          { provider: "unknown-provider" as "futu-stock", config: "daily-stock-market", enabled: true, required: true, include_asset_totals: true },
        ],
      }),
      runners: {},
    })).rejects.toThrow(/source runner not found/);
  });

  it("attaches an asset allocation pie chart when asset summaries are enabled", async () => {
    const runners: Record<string, StockPortfolioSourceRunner> = {
      "futu-stock": async () => ({
        text: JSON.stringify({
          source: "futu-opend-readonly",
          account_alias: "Futu",
          asset_summary: {
            currency: "CNY",
            total_assets: 1000,
            market_value: 900,
            cash: 100,
            buckets: [
              { category: "cash", label: "现金", currency: "CNY", market_value: 100, positions_count: 0, holdings: [] },
              { category: "stock", label: "个股", currency: "CNY", market_value: 900, positions_count: 1, holdings: [
                { code: "510300", name: "沪深300ETF", currency: "CNY", category: "stock", label: "个股", market_value: 900 },
              ] },
            ],
          },
        }),
      }),
    };

    const result = await runStockPortfolioProvider({
      configName: "daily-stock-summary",
      jobName: "daily-stock-summary",
      channelId: "channel",
      runAt: new Date("2026-05-08T09:00:00.000Z"),
    }, {
      loadProviderConfig: () => ({
        ...config,
        include_asset_summary: true,
        include_asset_pie_chart: true,
        sources: [
          { provider: "futu-stock", config: "daily-stock-summary", label: "Futu", enabled: true, required: true, include_asset_totals: true },
        ],
      }),
      runners,
    });

    expect(mocks.renderAssetPieChartPng).toHaveBeenCalledWith(expect.objectContaining({
      slices: expect.arrayContaining([
        expect.objectContaining({ label: "国内指数" }),
        expect.objectContaining({ label: "现金" }),
      ]),
    }), {
      profile: "daily-stock-summary",
      generatedAt: new Date("2026-05-08T09:00:00.000Z"),
    });
    expect(result.attachments).toEqual([{
      path: "/tmp/asset-pie.png",
      name: "stock-portfolio-daily-stock-summary-asset-pie.png",
      description: "Daily Stock Summary asset allocation pie chart",
    }]);
    expect(JSON.parse(result.text).usage_notes).toEqual(expect.arrayContaining([
      expect.stringContaining("PNG asset allocation pie chart"),
    ]));
  });

  it("keeps the report usable when pie chart generation fails", async () => {
    mocks.renderAssetPieChartPng.mockRejectedValueOnce(new Error("chromium unavailable"));
    const runners: Record<string, StockPortfolioSourceRunner> = {
      "futu-stock": async () => ({
        text: JSON.stringify({
          source: "futu-opend-readonly",
          account_alias: "Futu",
          asset_summary: {
            currency: "CNY",
            total_assets: 1000,
            market_value: 900,
            cash: 100,
            buckets: [
              { category: "stock", label: "个股", currency: "CNY", market_value: 900, positions_count: 1, holdings: [
                { code: "510300", name: "沪深300ETF", currency: "CNY", category: "stock", label: "个股", market_value: 900 },
              ] },
            ],
          },
        }),
      }),
    };

    const result = await runStockPortfolioProvider({
      configName: "daily-stock-summary",
      jobName: "daily-stock-summary",
      channelId: "channel",
      runAt: new Date("2026-05-08T09:00:00.000Z"),
    }, {
      loadProviderConfig: () => ({
        ...config,
        include_asset_summary: true,
        include_asset_pie_chart: true,
        sources: [
          { provider: "futu-stock", config: "daily-stock-summary", label: "Futu", enabled: true, required: true, include_asset_totals: true },
        ],
      }),
      runners,
    });

    const parsed = JSON.parse(result.text);
    expect(result.attachments).toBeUndefined();
    expect(parsed.warnings).toEqual(expect.arrayContaining([
      "asset pie chart generation failed: chromium unavailable",
    ]));
  });
});
