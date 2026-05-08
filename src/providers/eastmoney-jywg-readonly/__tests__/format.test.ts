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
    });

    const parsed = JSON.parse(formatEastmoneyJywgProviderPayload(payload));
    const indexBucket = parsed.asset_summary.buckets.find((bucket: { category: string }) => bucket.category === "domestic_index");

    expect(parsed.snapshot).toMatchObject({
      total_assets: 123456.78,
      market_value: 100000,
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
      expect.objectContaining({ category: "stock", market_value: 10000 }),
    ]));
    expect(indexBucket.holdings[0]).toMatchObject({
      code: "510300",
      market_value: 4000,
    });
  });
});
