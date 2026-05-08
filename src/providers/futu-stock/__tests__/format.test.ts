import { describe, expect, it } from "vitest";
import { buildFutuStockProviderPayload, formatFutuStockProviderPayload } from "../format.js";
import type { FutuAccountSnapshot, FutuStockProfileConfig } from "../../../mcp/futu-stock/types.js";

const profile: FutuStockProfileConfig = {
  opend_host: "127.0.0.1",
  opend_port: 11111,
  account_alias: "Futu HK",
  currency: "HKD",
  redaction: "summary",
  snapshot_dir: "~/.miniclaw/providers/futu-stock/snapshots",
  python_bin: "python3",
  trd_market: "HK",
  security_firm: "FUTUSECURITIES",
  allow_non_local_opend: false,
  show_total_assets: false,
};

const snapshot: FutuAccountSnapshot = {
  broker: "futu",
  account_alias: "Futu HK",
  captured_at: "2026-05-07T08:30:00.000Z",
  currency: "HKD",
  market_session: "a_hk_postmarket_1515",
  total_assets: 123456.78,
  market_value: 100000,
  cash: 23456.78,
  daily_pnl: 1234.56,
  daily_pnl_pct: 1.01,
  realized_pnl: 100,
  unrealized_pnl: 1134.56,
  positions: [
    {
      code: "HK.00700",
      name: "Tencent",
      currency: "HKD",
      quantity: 100,
      market_value: 50000,
      daily_pnl: 456.78,
      pnl_ratio: 2.1,
    },
    {
      code: "HK.02800",
      name: "Tracker Fund ETF",
      currency: "HKD",
      quantity: 1000,
      market_value: 20000,
      daily_pnl: -123.45,
      pnl_ratio: -0.8,
    },
  ],
  warnings: ["acc_id=123456789012 should be redacted"],
};

describe("futu-stock provider formatter", () => {
  it("formats redacted JSON for LLM cron context", () => {
    const payload = buildFutuStockProviderPayload(snapshot, profile, {
      generatedAt: new Date("2026-05-07T08:31:00.000Z"),
      profileName: "default",
      marketSession: "a_hk_postmarket_1515",
      redaction: "summary",
      topPositionsLimit: 5,
      includeAccountSnapshot: true,
      includeDailyReport: true,
      includePositionsSummary: true,
      includeAssetAllocation: false,
    });

    const text = formatFutuStockProviderPayload(payload);
    const parsed = JSON.parse(text);

    expect(parsed.source).toBe("futu-opend-readonly");
    expect(parsed.report).toContain("今日盈亏：+1,234.56 HKD");
    expect(parsed.snapshot.total_assets_range).toBe("100k-500k HKD");
    expect(text).not.toContain("123456.78");
    expect(text).not.toContain("123456789012");
    expect(text).toContain("acc_id=[redacted]");
    expect(parsed.positions_summary.top_positions[0]).toMatchObject({
      code: "HK.00700",
      name: "Tencent",
      daily_pnl: 456.78,
    });
    expect(parsed.positions_summary.top_positions[0]).not.toHaveProperty("quantity");
    expect(parsed.positions_summary.top_positions[0]).not.toHaveProperty("market_value");
    expect(parsed.positions_summary.pnl_summary).toMatchObject({
      currency: "HKD",
      gross_profit: 456.78,
      gross_loss: -123.45,
      net_pnl: 333.33,
      winners_count: 1,
      losers_count: 1,
      pnl_source: "positions_daily_pnl",
    });
    expect(parsed.positions_summary.top_gainers[0]).toMatchObject({
      code: "HK.00700",
      daily_pnl: 456.78,
      instrument_type: "stock",
    });
    expect(parsed.positions_summary.top_losers[0]).toMatchObject({
      code: "HK.02800",
      daily_pnl: -123.45,
      instrument_type: "etf",
    });
  });

  it("uses account-level daily P&L only as aggregate fallback", () => {
    const payload = buildFutuStockProviderPayload({
      ...snapshot,
      daily_pnl: 88,
      positions: [
        {
          code: "US.AAPL",
          name: "Apple",
          currency: "USD",
          market_value: 1000,
          pnl_value: 300,
        },
      ],
    }, profile, {
      generatedAt: new Date("2026-05-07T08:31:00.000Z"),
      profileName: "default",
      marketSession: "daily_summary_1700_bjt",
      redaction: "summary",
      topPositionsLimit: 5,
      includeAccountSnapshot: true,
      includeDailyReport: false,
      includePositionsSummary: true,
      includeAssetAllocation: false,
    });

    const parsed = JSON.parse(formatFutuStockProviderPayload(payload));
    expect(parsed.positions_summary.pnl_summary).toMatchObject({
      net_pnl: 88,
      gross_profit: 88,
      gross_loss: 0,
      positions_with_pnl_count: 0,
      pnl_source: "aggregate_pnl_fallback",
    });
    expect(parsed.positions_summary.top_positions).toEqual([]);
    expect(parsed.positions_summary.top_gainers).toEqual([]);
    expect(parsed.positions_summary.top_losers).toEqual([]);
  });

  it("includes exact asset allocation only when requested for private reports", () => {
    const payload = buildFutuStockProviderPayload(snapshot, { ...profile, redaction: "exact", show_total_assets: true }, {
      generatedAt: new Date("2026-05-07T08:31:00.000Z"),
      profileName: "default",
      marketSession: "daily_summary_1700_bjt",
      redaction: "exact",
      topPositionsLimit: 5,
      includeAccountSnapshot: true,
      includeDailyReport: true,
      includePositionsSummary: true,
      includeAssetAllocation: true,
    });

    const parsed = JSON.parse(formatFutuStockProviderPayload(payload));
    const stockBucket = parsed.asset_summary.buckets.find((bucket: { category: string }) => bucket.category === "stock");

    expect(parsed.snapshot).toMatchObject({
      total_assets: 123456.78,
      market_value: 100000,
      cash: 23456.78,
    });
    expect(parsed.asset_summary).toMatchObject({
      currency: "HKD",
      total_assets: 123456.78,
      cash: 23456.78,
    });
    expect(parsed.asset_summary.buckets).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "cash", market_value: 23456.78 }),
      expect.objectContaining({ category: "domestic_index", market_value: 20000 }),
      expect.objectContaining({ category: "stock", market_value: 50000 }),
    ]));
    expect(stockBucket.holdings[0]).toMatchObject({
      code: "HK.00700",
      market_value: 50000,
    });
  });
});
