import { describe, expect, it } from "vitest";
import { buildEastmoneyJywgProviderPayload, formatEastmoneyJywgProviderPayload } from "../format.js";
import type { EastmoneyJywgAccountSnapshot, EastmoneyJywgProfileConfig } from "../../../mcp/eastmoney-jywg/types.js";

const profile: EastmoneyJywgProfileConfig = {
  account_alias: "Eastmoney A",
  base_url: "https://jywg.18.cn",
  session_secret_path: "~/.miniclaw/secrets/eastmoney-jywg-session.json",
  browser_profile_dir: "~/.miniclaw/browser-profiles/eastmoney-jywg",
  snapshot_dir: "~/.miniclaw/providers/eastmoney-jywg-readonly/snapshots",
  redaction: "summary",
  top_positions_limit: 8,
  include_orders: false,
  include_deals: false,
  allow_non_jywg_host: false,
  fail_on_login_challenge: true,
  show_total_assets: false,
};

const snapshot: EastmoneyJywgAccountSnapshot = {
  broker: "eastmoney-jywg",
  account_alias: "Eastmoney A",
  captured_at: "2026-05-08T07:15:00.000Z",
  currency: "CNY",
  market_session: "a_share_close",
  total_assets: 123456.78,
  market_value: 100000,
  expanded_market_value: 14000,
  unclassified_market_value: 86000,
  cash_available: 23456.78,
  daily_pnl: 1234.56,
  daily_pnl_pct: 1.01,
  floating_pnl: 4567.89,
  positions: [
    { code: "600000", name: "浦发银行", currency: "CNY", quantity: 1000, market_value: 10000, daily_pnl: 456.78 },
    { code: "510300", name: "沪深300ETF", currency: "CNY", quantity: 1000, market_value: 4000, daily_pnl: -98.76 },
  ],
  warnings: ["account=123456789012 should be redacted"],
};

describe("eastmoney-jywg provider formatter", () => {
  it("formats redacted JSON for LLM cron context", () => {
    const payload = buildEastmoneyJywgProviderPayload(snapshot, profile, {
      generatedAt: new Date("2026-05-08T07:16:00.000Z"),
      profileName: "default",
      marketSession: "a_share_close",
      redaction: "summary",
      topPositionsLimit: 5,
      includeAccountSnapshot: true,
      includeDailyReport: true,
      includePositionsSummary: true,
      includeAssetAllocation: false,
      assetGapPolicy: { positive_market_value_gap: "unclassified" },
    });

    const text = formatEastmoneyJywgProviderPayload(payload);
    const parsed = JSON.parse(text);

    expect(parsed.source).toBe("eastmoney-jywg-readonly");
    expect(parsed.report).toContain("今日盈亏：+1,234.56 CNY");
    expect(parsed.snapshot.total_assets_range).toBe("100k-500k CNY");
    expect(text).not.toContain("123456.78");
    expect(text).not.toContain("123456789012");
    expect(text).toContain("account=[redacted]");
    expect(parsed.positions_summary.top_positions[0]).toMatchObject({
      code: "600000",
      name: "浦发银行",
      daily_pnl: 456.78,
    });
    expect(parsed.positions_summary.top_positions[0]).not.toHaveProperty("quantity");
    expect(parsed.positions_summary.top_positions[0]).not.toHaveProperty("market_value");
    expect(parsed.positions_summary.pnl_summary).toMatchObject({
      currency: "CNY",
      gross_profit: 456.78,
      gross_loss: -98.76,
      net_pnl: 358.02,
      winners_count: 1,
      losers_count: 1,
      pnl_source: "positions_daily_pnl",
    });
    expect(parsed.positions_summary.top_gainers[0]).toMatchObject({
      code: "600000",
      daily_pnl: 456.78,
      instrument_type: "stock",
    });
    expect(parsed.positions_summary.top_losers[0]).toMatchObject({
      code: "510300",
      daily_pnl: -98.76,
      instrument_type: "etf",
    });
  });

  it("uses account-level daily P&L only as aggregate fallback", () => {
    const payload = buildEastmoneyJywgProviderPayload({
      ...snapshot,
      daily_pnl: -66,
      positions: [
        {
          code: "510300",
          name: "沪深300ETF",
          currency: "CNY",
          market_value: 4000,
          floating_pnl: 500,
        },
      ],
    }, profile, {
      generatedAt: new Date("2026-05-08T07:16:00.000Z"),
      profileName: "default",
      marketSession: "daily_summary_1700_bjt",
      redaction: "summary",
      topPositionsLimit: 5,
      includeAccountSnapshot: true,
      includeDailyReport: false,
      includePositionsSummary: true,
      includeAssetAllocation: false,
      assetGapPolicy: { positive_market_value_gap: "unclassified" },
    });

    const parsed = JSON.parse(formatEastmoneyJywgProviderPayload(payload));
    expect(parsed.positions_summary.pnl_summary).toMatchObject({
      net_pnl: -66,
      gross_profit: 0,
      gross_loss: -66,
      positions_with_pnl_count: 0,
      pnl_source: "aggregate_pnl_fallback",
    });
    expect(parsed.positions_summary.top_positions).toEqual([]);
    expect(parsed.positions_summary.top_gainers).toEqual([]);
    expect(parsed.positions_summary.top_losers).toEqual([]);
  });

  it("includes exact asset allocation only when requested for private reports", () => {
    const payload = buildEastmoneyJywgProviderPayload(snapshot, { ...profile, redaction: "exact", show_total_assets: true }, {
      generatedAt: new Date("2026-05-08T07:16:00.000Z"),
      profileName: "default",
      marketSession: "daily_summary_1700_bjt",
      redaction: "exact",
      topPositionsLimit: 5,
      includeAccountSnapshot: true,
      includeDailyReport: true,
      includePositionsSummary: true,
      includeAssetAllocation: true,
      assetGapPolicy: { positive_market_value_gap: "unclassified" },
    });

    const parsed = JSON.parse(formatEastmoneyJywgProviderPayload(payload));
    const indexBucket = parsed.asset_summary.buckets.find((bucket: { category: string }) => bucket.category === "domestic_index");

    expect(parsed.snapshot).toMatchObject({
      total_assets: 123456.78,
      market_value: 100000,
      unclassified_market_value: 86000,
      cash_available: 23456.78,
    });
    expect(parsed.asset_summary).toMatchObject({
      currency: "CNY",
      total_assets: 123456.78,
      cash: 23456.78,
    });
    expect(parsed.asset_summary.buckets).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "cash", market_value: 23456.78 }),
      expect.objectContaining({ category: "domestic_index", market_value: 4000 }),
      expect.objectContaining({ category: "other", market_value: 86000 }),
      expect.objectContaining({ category: "stock", market_value: 10000 }),
    ]));
    const otherBucket = parsed.asset_summary.buckets.find((bucket: { category: string }) => bucket.category === "other");
    expect(otherBucket.holdings[0]).toMatchObject({
      code: "UNCLASSIFIED",
      name: "东方财富未展开证券市值",
      market_value: 86000,
      instrument_type: "unclassified_asset_gap",
    });
    expect(indexBucket.holdings[0]).toMatchObject({
      code: "510300",
      market_value: 4000,
    });
  });

  it("can treat a positive market-value gap as cash-like for daily asset summaries", () => {
    const payload = buildEastmoneyJywgProviderPayload(snapshot, { ...profile, redaction: "exact", show_total_assets: true }, {
      generatedAt: new Date("2026-05-08T07:16:00.000Z"),
      profileName: "default",
      marketSession: "daily_summary_1700_bjt",
      redaction: "exact",
      topPositionsLimit: 5,
      includeAccountSnapshot: true,
      includeDailyReport: true,
      includePositionsSummary: true,
      includeAssetAllocation: true,
      assetGapPolicy: {
        positive_market_value_gap: "cash_like",
        label: "Eastmoney A 现金资产",
      },
    });

    const parsed = JSON.parse(formatEastmoneyJywgProviderPayload(payload));
    const cashBucket = parsed.asset_summary.buckets.find((bucket: { category: string }) => bucket.category === "cash");
    const otherBucket = parsed.asset_summary.buckets.find((bucket: { category: string }) => bucket.category === "other");

    expect(parsed.asset_summary).toMatchObject({
      currency: "CNY",
      total_assets: 123456.78,
      market_value: 14000,
      cash: 109456.78,
    });
    expect(cashBucket).toMatchObject({
      category: "cash",
      market_value: 109456.78,
    });
    expect(cashBucket.holdings[0]).toMatchObject({
      code: "CASH",
      market_value: 109456.78,
    });
    expect(otherBucket).toBeUndefined();
    expect(parsed.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("Eastmoney A 现金资产 86000 CNY is treated as cash-like asset"),
    ]));
  });
});
