import { describe, expect, it } from "vitest";
import { formatEastmoneyJywgDailyPnlReport, redactedSnapshotJson, redactSensitiveText } from "../redact.js";
import type { EastmoneyJywgAccountSnapshot, EastmoneyJywgProfileConfig } from "../types.js";

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
  positions: [{ code: "600000", name: "浦发银行", currency: "CNY", daily_pnl: 456.78, pnl_ratio: 2.1 }],
  warnings: ["validatekey=abcdefabcdefabcdefabcdef should be redacted"],
};

describe("eastmoney-jywg redaction", () => {
  it("redacts tokens, cookies, phone numbers, and account-like values", () => {
    const text = redactSensitiveText("phone=13800138000 account=123456789012 cookie=abcdefabcdefabcdefabcdef validatekey=secret");

    expect(text).toContain("[redacted-phone]");
    expect(text).toContain("account=[redacted]");
    expect(text).toContain("cookie=[redacted]");
    expect(text).toContain("validatekey=[redacted]");
  });

  it("hides exact total assets by default", () => {
    const text = redactedSnapshotJson(snapshot, profile);

    expect(text).not.toContain("123456.78");
    expect(text).toContain("total_assets_range");
    expect(text).toContain("validatekey=[redacted]");
  });

  it("formats a daily report without exact total assets", () => {
    const text = formatEastmoneyJywgDailyPnlReport(snapshot, profile, { topPositionsLimit: 3 });

    expect(text).toContain("今日盈亏：+1,234.56 CNY");
    expect(text).toContain("总资产：已脱敏");
    expect(text).not.toContain("123456.78");
    expect(text).toContain("600000 浦发银行");
  });
});
