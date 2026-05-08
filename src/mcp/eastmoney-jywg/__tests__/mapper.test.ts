import { describe, expect, it } from "vitest";
import { mapEastmoneyJywgRawBrokerData, topEastmoneyJywgPositionsByPnl } from "../mapper.js";
import type { EastmoneyJywgProfileConfig, EastmoneyJywgRawBrokerData } from "../types.js";

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

const raw: EastmoneyJywgRawBrokerData = {
  captured_at: "2026-05-08T07:15:00.000Z",
  asset_and_position: { Status: 0, Data: [{ Zzc: "101000", Zxsz: "80000", Kyzj: "21000", Zjye: "22000" }] },
  positions: {
    Status: 0,
    Data: [
      { Zqdm: "600000", Zqmc: "浦发银行", Zqsl: "1000", Zxjg: "10", Drckyk: "120", Ykbl: "1.2" },
      { Zqdm: "000001", Zqmc: "平安银行", Zqsl: "500", Zxjg: "8", Drckyk: "-300", Ykbl: "-2.0" },
    ],
  },
  updated_session: { version: 1, host: "jywg.18.cn", cookies: [{ name: "sid", value: "abc" }] },
  warnings: [],
};

describe("mapEastmoneyJywgRawBrokerData", () => {
  it("maps asset and position fields into a daily pnl snapshot", () => {
    const snapshot = mapEastmoneyJywgRawBrokerData(raw, profile, "a_share_close");

    expect(snapshot.daily_pnl).toBe(-180);
    expect(snapshot.daily_pnl_pct).toBeCloseTo(-0.178);
    expect(snapshot.total_assets).toBe(101000);
    expect(snapshot.positions).toHaveLength(2);
    expect(snapshot.positions[0]).toMatchObject({
      code: "600000",
      name: "浦发银行",
      market_value: 10000,
      daily_pnl: 120,
    });
  });

  it("sorts top positions by absolute pnl", () => {
    const snapshot = mapEastmoneyJywgRawBrokerData(raw, profile);

    expect(topEastmoneyJywgPositionsByPnl(snapshot, 1).map((position) => position.code)).toEqual(["000001"]);
  });
});
