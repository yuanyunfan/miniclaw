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
  positions: [{ code: "600000", name: "浦发银行", currency: "CNY", quantity: 1000, market_value: 10000, daily_pnl: 456.78 }],
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
  });
});
