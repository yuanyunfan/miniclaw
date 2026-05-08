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
  sources: [
    { provider: "futu-stock", config: "daily-stock-market", enabled: true, required: false },
    { provider: "eastmoney-jywg-readonly", config: "daily-stock-market", enabled: true, required: false },
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
    expect(payload.cny_summary?.top_gainers[0]).toMatchObject({
      code: "HK.00700",
      pnl_cny: 92,
      instrument_type: "stock",
    });
    expect(payload.cny_summary?.top_losers[0]).toMatchObject({
      code: "HK.02800",
      pnl_cny: -27.6,
      instrument_type: "etf",
    });
  });
});
