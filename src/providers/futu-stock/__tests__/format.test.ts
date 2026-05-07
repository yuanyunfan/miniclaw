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
  });
});
