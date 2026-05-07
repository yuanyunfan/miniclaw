import { describe, expect, it } from "vitest";
import { createFutuStockToolHandlers } from "../server.js";
import type { FutuRawBrokerData, FutuStockClient, FutuStockConfig } from "../types.js";

const config: FutuStockConfig = {
  profiles: {
    default: {
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
    },
  },
};

const raw: FutuRawBrokerData = {
  captured_at: "2026-05-07T08:30:00.000Z",
  account: { total_assets: 100000, cash: 20000, market_val: 80000 },
  positions: [
    { code: "HK.00700", stock_name: "Tencent", today_pl_val: 500, pl_ratio: 1.2 },
    { code: "HK.09988", stock_name: "Alibaba", today_pl_val: -100, pl_ratio: -0.8 },
  ],
};

const client: FutuStockClient = {
  async healthCheck() {
    return {
      ok: true,
      opend: { ok: true, host: "127.0.0.1", port: 11111 },
      python: { ok: true, bin: "python3", futu_api_available: true },
    };
  },
  async getRawBrokerData() {
    return raw;
  },
};

describe("createFutuStockToolHandlers", () => {
  it("builds a redacted daily pnl report from the injected client", async () => {
    const handlers = createFutuStockToolHandlers({ client, loadConfig: () => config });

    const result = await handlers.futu_get_daily_pnl_report({ market_session: "hk_close", top_positions_limit: 2 });

    expect("isError" in result ? result.isError : undefined).toBeUndefined();
    expect(result.content[0].text).toContain("今日盈亏：+400 HKD");
    expect(result.content[0].text).toContain("市场口径：hk_close");
    expect(result.content[0].text).toContain("总资产：已脱敏");
  });

  it("returns safe tool errors without throwing raw exceptions", async () => {
    const failingClient: FutuStockClient = {
      async healthCheck() {
        throw new Error("token=abcabcabcabcabcabcabcabcabcabc should not leak");
      },
      async getRawBrokerData() {
        throw new Error("unused");
      },
    };
    const handlers = createFutuStockToolHandlers({ client: failingClient, loadConfig: () => config });

    const result = await handlers.futu_health_check({});

    expect("isError" in result ? result.isError : undefined).toBe(true);
    expect(result.content[0].text).toContain("[redacted]");
    expect(result.content[0].text).not.toContain("abcabcabcabc");
  });
});
