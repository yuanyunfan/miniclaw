import { beforeEach, describe, expect, it, vi } from "vitest";
import { runStockPortfolioProvider } from "../index.js";
import type { StockPortfolioProviderConfig, StockPortfolioSourceRunner } from "../../../stock/data/portfolio-types.js";

const mocks = vi.hoisted(() => ({
  renderAssetPieChartPng: vi.fn(),
  renderEquityLookthroughChartPng: vi.fn(),
}));

vi.mock("../../../stock/reports/portfolio-equity-lookthrough-chart.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../stock/reports/portfolio-equity-lookthrough-chart.js")>();
  return {
    ...actual,
    renderEquityLookthroughChartPng: mocks.renderEquityLookthroughChartPng,
  };
});

vi.mock("../../../stock/reports/portfolio-pie-chart.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../stock/reports/portfolio-pie-chart.js")>();
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
  include_equity_lookthrough_summary: false,
  include_equity_lookthrough_chart: false,
  equity_lookthrough_top_limit: 30,
  equity_lookthrough_sources: [],
  sources: [
    { provider: "futu-stock", config: "daily-stock-market", label: "Futu", enabled: true, required: false, include_asset_totals: true },
    { provider: "eastmoney-jywg-readonly", config: "daily-stock-market", label: "Eastmoney", enabled: true, required: false, include_asset_totals: true },
  ],
};

describe("runStockPortfolioProvider", () => {
  beforeEach(() => {
    mocks.renderAssetPieChartPng.mockReset();
    mocks.renderAssetPieChartPng.mockResolvedValue("/tmp/asset-pie.png");
    mocks.renderEquityLookthroughChartPng.mockReset();
    mocks.renderEquityLookthroughChartPng.mockResolvedValue("/tmp/equity-lookthrough.png");
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

  it("runs configured Eastmoney ETF premium source and merges it into held premium rows", async () => {
    const runners: Record<string, StockPortfolioSourceRunner> = {
      "eastmoney-jywg-readonly": async () => ({
        text: JSON.stringify({
          source: "eastmoney-jywg-readonly",
          positions_summary: {
            position_premiums: [
              { code: "159632", name: "纳斯达克", currency: "CNY", status: "missing_from_eastmoney_position" },
            ],
          },
        }),
      }),
      "eastmoney-etf-premium": async () => ({
        text: JSON.stringify({
          source: "eastmoney-etf-premium",
          premium_summary: {
            source: "eastmoney_fund_selector",
            items: [
              {
                code: "159632",
                name: "纳斯达克ETF华安",
                status: "ok",
                data_source: "eastmoney_fund_selector",
                captured_at: "2026-05-16T07:30:02.000Z",
                premium_rate: 1.51,
                eastmoney_discount_ratio: -1.51,
                latest_price: 2.326,
              },
            ],
          },
        }),
      }),
    };

    const result = await runStockPortfolioProvider({
      configName: "cn-stock",
      jobName: "cn-stock-ing-market",
      channelId: "channel",
      runAt: new Date("2026-05-16T07:30:02.000Z"),
    }, {
      loadProviderConfig: () => ({
        ...config,
        sources: [
          { provider: "eastmoney-jywg-readonly", config: "cn-stock", label: "Eastmoney A", enabled: true, required: false, include_asset_totals: true },
          { provider: "eastmoney-etf-premium", config: "cn-stock", label: "Eastmoney ETF premium", enabled: true, required: false, include_asset_totals: false },
        ],
      }),
      runners,
    });

    const parsed = JSON.parse(result.text);

    expect(parsed.ok_count).toBe(2);
    expect(parsed.position_premium_summary.items[0]).toMatchObject({
      code: "159632",
      data_source: "eastmoney_fund_selector",
      status: "ok",
      premium_rate: 1.51,
      eastmoney_discount_ratio: -1.51,
      premium_source_provider: "eastmoney-etf-premium",
    });
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
        expect.objectContaining({ label: "国内股票" }),
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

  it("attaches the equity look-through chart after the asset allocation pie chart", async () => {
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
              { category: "stock", label: "个股", currency: "CNY", market_value: 400, positions_count: 1, holdings: [
                { code: "US.NVDA", name: "NVIDIA", currency: "CNY", category: "stock", label: "个股", market_value: 400, instrument_type: "stock" },
              ] },
              { category: "foreign_index", label: "国外指数", currency: "CNY", market_value: 500, positions_count: 1, holdings: [
                { code: "US.SPY", name: "S&P 500 ETF", currency: "CNY", category: "foreign_index", label: "国外指数", market_value: 500, instrument_type: "etf" },
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
        include_equity_lookthrough_summary: true,
        include_equity_lookthrough_chart: true,
        equity_lookthrough_top_limit: 30,
        equity_lookthrough_sources: [
          {
            label: "S&P 500",
            match_codes: ["US.SPY"],
            match_names: [],
            company_aliases: [],
            constituents: [
              { company_key: "NVDA", company: "NVIDIA", code: "NVDA", aliases: ["US.NVDA"], weight_pct: 7 },
            ],
          },
        ],
        sources: [
          { provider: "futu-stock", config: "daily-stock-summary", label: "Futu", enabled: true, required: true, include_asset_totals: true },
        ],
      }),
      runners,
    });

    expect(mocks.renderEquityLookthroughChartPng).toHaveBeenCalledWith(expect.objectContaining({
      rows: [
        expect.objectContaining({
          company: "NVIDIA",
          lookthrough_amount_cny: 435,
          source_labels: ["直接", "S&P 500"],
        }),
      ],
    }), {
      profile: "daily-stock-summary",
      generatedAt: new Date("2026-05-08T09:00:00.000Z"),
    });
    expect(result.attachments).toEqual([
      {
        path: "/tmp/asset-pie.png",
        name: "stock-portfolio-daily-stock-summary-asset-pie.png",
        description: "Daily Stock Summary asset allocation pie chart",
      },
      {
        path: "/tmp/equity-lookthrough.png",
        name: "stock-portfolio-daily-stock-summary-equity-lookthrough.png",
        description: "Daily Stock Summary single-stock look-through exposure table",
      },
    ]);
    expect(JSON.parse(result.text).usage_notes).toEqual(expect.arrayContaining([
      expect.stringContaining("single-stock look-through exposure table after the asset allocation pie chart"),
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
