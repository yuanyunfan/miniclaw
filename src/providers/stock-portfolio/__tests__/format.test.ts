import { describe, expect, it } from "vitest";
import { buildStockPortfolioPayload, formatStockPortfolioPayload } from "../format.js";
import type { StockPortfolioProviderConfig } from "../types.js";

const config: StockPortfolioProviderConfig = {
  continue_on_error: true,
  fail_if_all_sources_fail: true,
  market_scope: "all",
  base_currency: "CNY",
  fx_rates: { CNY: 1, HKD: 0.92, USD: 7.2 },
  fx_rates_as_of: "2026-05-08",
  fx_rates_source: "test",
  top_movers_limit: 5,
  include_cny_summary: true,
  include_asset_summary: false,
  include_asset_pie_chart: false,
  sources: [
    { provider: "futu-stock", config: "daily-stock-market", enabled: true, required: false, include_asset_totals: true },
    { provider: "eastmoney-jywg-readonly", config: "daily-stock-market", enabled: true, required: false, include_asset_totals: true },
  ],
};

describe("stock-portfolio formatter", () => {
  it("formats aggregate payload and redacts nested sensitive strings", () => {
    const payload = buildStockPortfolioPayload({
      generatedAt: new Date("2026-05-08T01:15:00.000Z"),
      profile: "daily-stock-market",
      config,
      sources: [
        {
          provider: "futu-stock",
          config: "daily-stock-market",
          status: "ok",
          payload: { source: "futu-opend-readonly", warning: "acc_id=123456789012" },
        },
        {
          provider: "eastmoney-jywg-readonly",
          config: "daily-stock-market",
          status: "error",
          error: "cookie=abcabcabcabcabcabcabcabcabcabc",
        },
      ],
    });

    const text = formatStockPortfolioPayload(payload);
    const parsed = JSON.parse(text);

    expect(parsed.source).toBe("stock-portfolio");
    expect(parsed.ok_count).toBe(1);
    expect(parsed.failed_count).toBe(1);
    expect(text).toContain("acc_id=[redacted]");
    expect(text).toContain("cookie=[redacted]");
    expect(text).not.toContain("123456789012");
  });

  it("builds CNY profit/loss rollups from source summaries and top movers", () => {
    const payload = buildStockPortfolioPayload({
      generatedAt: new Date("2026-05-08T01:15:00.000Z"),
      profile: "daily-stock-market",
      config,
      sources: [
        {
          provider: "futu-stock",
          config: "daily-stock-market",
          label: "Futu",
          status: "ok",
          payload: {
            positions_summary: {
              pnl_summary: {
                currency: "HKD",
                gross_profit: 100,
                gross_loss: -30,
                net_pnl: 70,
                winners_count: 2,
                losers_count: 1,
                flat_count: 0,
                positions_with_pnl_count: 3,
              },
              top_gainers: [{ code: "HK.00700", name: "Tencent", currency: "HKD", daily_pnl: 100 }],
              top_losers: [{ code: "HK.02800", name: "Tracker Fund ETF", currency: "HKD", daily_pnl: -30 }],
            },
          },
        },
        {
          provider: "eastmoney-jywg-readonly",
          config: "daily-stock-market",
          label: "Eastmoney",
          status: "ok",
          payload: {
            positions_summary: {
              pnl_summary: {
                currency: "CNY",
                gross_profit: 50,
                gross_loss: -10,
                net_pnl: 40,
                winners_count: 1,
                losers_count: 1,
                flat_count: 0,
                positions_with_pnl_count: 2,
              },
              top_gainers: [{ code: "600000", name: "浦发银行", currency: "CNY", daily_pnl: 50 }],
              top_losers: [{ code: "510300", name: "沪深300ETF", currency: "CNY", daily_pnl: -10 }],
            },
          },
        },
      ],
    });

    expect(payload.cny_summary).toMatchObject({
      base_currency: "CNY",
      gross_profit_cny: 142,
      gross_loss_cny: -37.6,
      net_pnl_cny: 104.4,
      winners_count: 3,
      losers_count: 2,
    });
    expect(payload.cny_summary?.by_currency).toHaveLength(2);
    expect(payload.cny_summary?.by_currency).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_currency: "HKD", gross_profit_cny: 92, gross_loss_cny: -27.6 }),
      expect.objectContaining({ source_currency: "CNY", gross_profit_cny: 50, gross_loss_cny: -10 }),
    ]));
    expect(payload.cny_summary?.by_currency[0]).not.toHaveProperty("gross_profit");
    expect(payload.cny_summary?.by_currency[0]).not.toHaveProperty("currency");
    expect(payload.cny_summary?.top_gainers[0]).toMatchObject({
      code: "HK.00700",
      source_currency: "HKD",
      pnl_cny: 92,
      instrument_type: "stock",
    });
    expect(payload.cny_summary?.top_gainers[0]).not.toHaveProperty("pnl");
    expect(payload.cny_summary?.top_gainers[0]).not.toHaveProperty("currency");
    expect(payload.cny_summary?.top_losers[0]).toMatchObject({
      code: "HK.02800",
      pnl_cny: -27.6,
      instrument_type: "etf",
    });
  });

  it("formats summaries before verbose source payloads for cron prompt truncation", () => {
    const payload = buildStockPortfolioPayload({
      generatedAt: new Date("2026-05-08T01:15:00.000Z"),
      profile: "cn-stock",
      config,
      sources: [
        {
          provider: "eastmoney-jywg-readonly",
          config: "cn-stock",
          label: "Eastmoney",
          status: "ok",
          payload: {
            positions_summary: {
              pnl_summary: {
                currency: "CNY",
                gross_profit: 50,
                gross_loss: -10,
                net_pnl: 40,
                winners_count: 1,
                losers_count: 1,
                flat_count: 0,
                positions_with_pnl_count: 2,
              },
              top_gainers: [{ code: "600000", name: "浦发银行", currency: "CNY", daily_pnl: 50 }],
              top_losers: [{ code: "510300", name: "沪深300ETF", currency: "CNY", daily_pnl: -10 }],
            },
            verbose_tail: "x".repeat(12_000),
          },
        },
      ],
    });

    const formatted = formatStockPortfolioPayload(payload);

    expect(formatted.indexOf('"cny_summary"')).toBeGreaterThan(-1);
    expect(formatted.indexOf('"sources"')).toBeGreaterThan(-1);
    expect(formatted.indexOf('"cny_summary"')).toBeLessThan(formatted.indexOf('"sources"'));
    expect(formatted.slice(0, 8000)).toContain('"cny_summary"');
    expect(formatted.slice(0, 8000)).toContain('"top_gainers"');
  });

  it("builds CNY asset allocation rollups from exact source summaries", () => {
    const payload = buildStockPortfolioPayload({
      generatedAt: new Date("2026-05-08T09:00:00.000Z"),
      profile: "daily-stock-summary",
      config: { ...config, include_asset_summary: true },
      sources: [
        {
          provider: "futu-stock",
          config: "daily-stock-summary-hk",
          label: "Futu HK",
          status: "ok",
          payload: {
            snapshot: { account_alias: "Futu HK" },
            positions_summary: {
              positions_count: 1,
              pnl_summary: {
                currency: "HKD",
                gross_profit: 10,
                gross_loss: -2,
                net_pnl: 8,
                winners_count: 1,
                losers_count: 1,
                flat_count: 0,
                positions_with_pnl_count: 2,
              },
            },
            asset_summary: {
              currency: "HKD",
              total_assets: 1100,
              market_value: 900,
              cash: 200,
              buckets: [
                {
                  category: "cash",
                  label: "现金",
                  currency: "HKD",
                  market_value: 200,
                  positions_count: 0,
                  holdings: [{ code: "CASH", name: "Cash", currency: "HKD", category: "cash", label: "现金", market_value: 200 }],
                },
                {
                  category: "other",
                  label: "其他",
                  currency: "HKD",
                  market_value: 900,
                  positions_count: 2,
                  holdings: [
                    { code: "HK.02800", name: "Tracker Fund ETF", currency: "HKD", category: "other", label: "其他", market_value: 800 },
                    { code: "513030", name: "德国ETF", currency: "HKD", category: "other", label: "其他", market_value: 100 },
                  ],
                },
              ],
            },
          },
        },
        {
          provider: "eastmoney-jywg-readonly",
          config: "daily-stock-summary",
          label: "Eastmoney A",
          status: "ok",
          payload: {
            snapshot: { account_alias: "Eastmoney A" },
            asset_summary: {
              currency: "CNY",
              total_assets: 2000,
              market_value: 1500,
              cash: 500,
              buckets: [
                { category: "cash", label: "现金", currency: "CNY", market_value: 500, positions_count: 0, holdings: [] },
                { category: "gold", label: "黄金", currency: "CNY", market_value: 1500, positions_count: 1, holdings: [
                  { code: "518880", name: "黄金ETF", currency: "CNY", category: "gold", label: "黄金", market_value: 1500 },
                ] },
              ],
            },
          },
        },
      ],
    });

    expect(payload.asset_summary).toMatchObject({
      base_currency: "CNY",
      total_assets_cny: 3012,
      market_value_cny: 2328,
      cash_cny: 684,
    });
    expect(payload.asset_summary?.by_account).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Futu HK", total_assets_cny: 1012 }),
      expect.objectContaining({ label: "Eastmoney A", total_assets_cny: 2000 }),
    ]));
    expect(payload.asset_summary?.by_category).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "other", market_value_cny: 828 }),
      expect.objectContaining({ category: "gold", market_value_cny: 1500 }),
      expect.objectContaining({ category: "cash", market_value_cny: 684 }),
    ]));
    expect(payload.asset_summary?.holdings_for_classification).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "HK.02800", name: "Tracker Fund ETF", market_value_cny: 736 }),
      expect.objectContaining({ code: "513030", name: "德国ETF", market_value_cny: 92 }),
      expect.objectContaining({ code: "518880", name: "黄金ETF", market_value_cny: 1500 }),
    ]));
    expect(payload.asset_summary?.holdings_for_classification).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "CASH" }),
    ]));
    expect(payload.asset_summary?.classification_guidance).toMatchObject({
      mode: "llm",
      categories: expect.arrayContaining([
        expect.objectContaining({ category: "domestic_index", label: "国内指数" }),
        expect.objectContaining({ category: "foreign_stock", label: "国外个股" }),
        expect.objectContaining({ category: "foreign_index", label: "国外指数" }),
        expect.objectContaining({ category: "domestic_stock", label: "国内个股" }),
        expect.objectContaining({ category: "bond", label: "债券" }),
        expect.objectContaining({ category: "gold", label: "黄金" }),
      ]),
      instructions: expect.arrayContaining([
        "After final classification, aggregate category totals and sort categories by market_value_cny descending.",
        "Within each category, list every ETF or stock holding on its own line sorted by market_value_cny descending.",
        "Holdings with instrument_type=unclassified_asset_gap are reconciliation rows for broker market value that was not expanded into position details; show them separately and do not force them into the six investment categories.",
      ]),
    });
    expect(payload.asset_summary?.by_account[0]).not.toHaveProperty("total_assets");
    expect(payload.asset_summary?.by_account[0]).not.toHaveProperty("market_value");
    expect(payload.asset_summary?.by_account[0]).not.toHaveProperty("cash");
    expect(payload.asset_summary?.by_category[0].holdings[0]).not.toHaveProperty("market_value");
    expect(payload.asset_summary?.by_category[0].holdings[0]).not.toHaveProperty("currency");

    const formatted = formatStockPortfolioPayload(payload);
    const parsed = JSON.parse(formatted);
    expect(parsed.sources[0].payload).toMatchObject({
      source_currency: "HKD",
      pnl_summary_cny: {
        source_currency: "HKD",
        gross_profit_cny: 9.2,
        gross_loss_cny: -1.84,
        net_pnl_cny: 7.36,
      },
    });
    expect(formatted).not.toMatch(/"(total_assets|market_value|cash|pnl|gross_profit|gross_loss|net_pnl)"\s*:/);
  });

  it("keeps positions but skips account totals for positions-only market sources", () => {
    const payload = buildStockPortfolioPayload({
      generatedAt: new Date("2026-05-08T09:00:00.000Z"),
      profile: "daily-stock-summary",
      config: { ...config, include_asset_summary: true },
      sources: [
        {
          provider: "futu-stock",
          config: "daily-stock-summary-hk",
          label: "Futu HK",
          include_asset_totals: false,
          status: "ok",
          payload: {
            snapshot: { account_alias: "Futu HK" },
            asset_summary: {
              currency: "HKD",
              total_assets: 1100,
              market_value: 900,
              cash: 200,
              buckets: [
                { category: "cash", label: "现金", currency: "HKD", market_value: 200, positions_count: 0, holdings: [
                  { code: "CASH", name: "Cash", currency: "HKD", category: "cash", label: "现金", market_value: 200 },
                ] },
                { category: "other", label: "其他", currency: "HKD", market_value: 900, positions_count: 2, holdings: [
                  { code: "HK.02800", name: "Tracker Fund ETF", currency: "HKD", category: "other", label: "其他", market_value: 800 },
                  { code: "513030", name: "德国ETF", currency: "HKD", category: "other", label: "其他", market_value: 100 },
                ] },
              ],
            },
          },
        },
        {
          provider: "futu-stock",
          config: "daily-stock-summary-us",
          label: "Futu US",
          asset_account_label: "Futu",
          include_asset_totals: true,
          status: "ok",
          payload: {
            snapshot: { account_alias: "Futu US" },
            asset_summary: {
              currency: "USD",
              total_assets: 1115,
              market_value: 915,
              cash: 200,
              buckets: [
                { category: "cash", label: "现金", currency: "USD", market_value: 200, positions_count: 0, holdings: [
                  { code: "CASH", name: "Cash", currency: "USD", category: "cash", label: "现金", market_value: 200 },
                ] },
                { category: "stock", label: "个股", currency: "USD", market_value: 800, positions_count: 1, holdings: [
                  { code: "US.AAPL", name: "Apple", currency: "USD", category: "stock", label: "个股", market_value: 800 },
                ] },
              ],
            },
          },
        },
      ],
    });

    expect(payload.asset_summary?.by_account).toHaveLength(1);
    expect(payload.asset_summary?.by_account[0]).toMatchObject({ label: "Futu", total_assets_cny: 8028 });
    expect(payload.asset_summary?.cash_cny).toBe(1440);
    expect(payload.asset_summary?.by_category).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "other", market_value_cny: 828 }),
      expect.objectContaining({ category: "stock", market_value_cny: 5760 }),
      expect.objectContaining({ category: "cash", market_value_cny: 1440 }),
    ]));
    expect(payload.asset_summary?.holdings_for_classification).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "HK.02800", market_value_cny: 736 }),
      expect.objectContaining({ code: "513030", market_value_cny: 92 }),
      expect.objectContaining({ code: "US.AAPL", market_value_cny: 5760 }),
    ]));
  });
});
