import { describe, expect, it } from "vitest";
import { mapFutuRawBrokerData, topFutuPositionsByDailyPnl } from "../mapper.js";
import type { FutuStockProfileConfig } from "../types.js";

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

describe("mapFutuRawBrokerData", () => {
  it("maps account and position fields into a daily pnl snapshot", () => {
    const snapshot = mapFutuRawBrokerData({
      captured_at: "2026-05-07T08:30:00.000Z",
      account: {
        total_assets: "101000",
        market_val: 80000,
        cash: 21000,
        realized_pl: 50,
        unrealized_pl: 950,
      },
      positions: [
        { code: "HK.00700", stock_name: "Tencent", qty: 100, today_pl_val: 1200, pl_ratio: 3.2, market_val: 60000, currency: "HKD" },
        { code: "HK.09988", stock_name: "Alibaba", qty: 200, today_pl_val: -200, pl_ratio: -1.1, market_val: 20000, currency: "HKD" },
      ],
    }, profile, "hk_close");

    expect(snapshot.daily_pnl).toBe(1000);
    expect(snapshot.daily_pnl_pct).toBeCloseTo(1);
    expect(snapshot.positions).toHaveLength(2);
    expect(snapshot.warnings).toEqual([]);
  });

  it("sorts top positions by absolute daily pnl", () => {
    const snapshot = mapFutuRawBrokerData({
      captured_at: "2026-05-07T08:30:00.000Z",
      account: {},
      positions: [
        { code: "A", stock_name: "A", today_pl_val: 10 },
        { code: "B", stock_name: "B", today_pl_val: -50 },
        { code: "C", stock_name: "C", today_pl_val: 20 },
      ],
    }, profile);

    expect(topFutuPositionsByDailyPnl(snapshot, 2).map((p) => p.code)).toEqual(["B", "C"]);
  });
});
