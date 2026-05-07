import { describe, expect, it } from "vitest";
import { formatFutuDailyPnlReport, redactedSnapshotJson, redactSensitiveText } from "../redact.js";
import type { FutuAccountSnapshot, FutuStockProfileConfig } from "../types.js";

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
  market_session: "hk_close",
  total_assets: 123456.78,
  market_value: 100000,
  cash: 23456.78,
  daily_pnl: 1234.56,
  daily_pnl_pct: 1.01,
  realized_pnl: 100,
  unrealized_pnl: 1134.56,
  positions: [
    { code: "HK.00700", name: "Tencent", currency: "HKD", daily_pnl: 456.78, pnl_ratio: 2.1 },
  ],
  warnings: [],
};

describe("futu-stock redaction", () => {
  it("redacts account-like numbers, phone numbers, and token values", () => {
    const text = redactSensitiveText("phone=13800138000 acc_id=123456789012 token=abcdefabcdefabcdefabcdefabcdef");

    expect(text).toContain("[redacted-phone]");
    expect(text).toContain("acc_id=[redacted]");
    expect(text).toContain("token=[redacted]");
  });

  it("hides exact total assets by default", () => {
    const text = redactedSnapshotJson(snapshot, profile);

    expect(text).not.toContain("123456.78");
    expect(text).toContain("total_assets_range");
  });

  it("keeps long fractional percentages valid while redacting account-like whole numbers", () => {
    const text = redactedSnapshotJson({
      ...snapshot,
      daily_pnl_pct: 0.004016064257028112,
      warnings: ["acc_id=123456789012 should be hidden"],
    }, profile);
    const parsed = JSON.parse(text);

    expect(parsed.daily_pnl_pct).toBe(0.004016064257028112);
    expect(text).toContain("acc_id=[redacted]");
    expect(text).not.toContain("123456789012");
  });

  it("does not corrupt large numeric JSON values during string redaction", () => {
    const text = redactedSnapshotJson({
      ...snapshot,
      daily_pnl: 12345678901,
      warnings: ["phone=13800138000"],
    }, profile);
    const parsed = JSON.parse(text);

    expect(parsed.daily_pnl).toBe(12345678901);
    expect(text).toContain("[redacted-phone]");
  });

  it("formats a Discord-ready daily report without exact total assets", () => {
    const text = formatFutuDailyPnlReport(snapshot, profile, { topPositionsLimit: 3 });

    expect(text).toContain("今日盈亏：+1,234.56 HKD");
    expect(text).toContain("总资产：已脱敏");
    expect(text).not.toContain("123456.78");
    expect(text).toContain("HK.00700 Tencent");
  });
});
