import { describe, expect, it } from "vitest";
import { runStockPortfolioProvider } from "../index.js";
import type { StockPortfolioProviderConfig, StockPortfolioSourceRunner } from "../types.js";

const config: StockPortfolioProviderConfig = {
  continue_on_error: true,
  fail_if_all_sources_fail: true,
  market_scope: "all",
  base_currency: "CNY",
  fx_rates: { CNY: 1, HKD: 0.92 },
  top_movers_limit: 5,
  include_cny_summary: true,
  include_asset_summary: false,
  sources: [
    { provider: "futu-stock", config: "daily-stock-market", label: "Futu", enabled: true, required: false, include_asset_totals: true },
    { provider: "eastmoney-jywg-readonly", config: "daily-stock-market", label: "Eastmoney", enabled: true, required: false, include_asset_totals: true },
  ],
};

describe("runStockPortfolioProvider", () => {
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
});
