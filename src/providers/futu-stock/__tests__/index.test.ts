import { describe, expect, it } from "vitest";
import { runFutuStockProvider } from "../index.js";
import type { FutuRawBrokerData, FutuStockClient, FutuStockConfig } from "../../../mcp/futu-stock/types.js";
import type { FutuStockProviderConfig } from "../../../stock/reports/futu-stock-types.js";

const futuConfig: FutuStockConfig = {
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

const providerConfig: FutuStockProviderConfig = {
  profile: "default",
  account_alias: "Futu",
  market_session_by_job: {
    "stock-market-premarket": "premarket_0915",
  },
  redaction: "summary",
  top_positions_limit: 2,
  include_account_snapshot: true,
  include_daily_report: true,
  include_positions_summary: true,
  include_asset_allocation: false,
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

describe("runFutuStockProvider", () => {
  it("returns parseable redacted account context with an injected client", async () => {
    const result = await runFutuStockProvider({
      configName: "daily-stock-market",
      jobName: "stock-market-premarket",
      channelId: "channel",
      runAt: new Date("2026-05-07T01:15:00.000Z"),
    }, {
      client,
      loadFutuConfig: () => futuConfig,
      loadProviderConfig: () => providerConfig,
    });

    const parsed = JSON.parse(result.text);

    expect(parsed.account_alias).toBe("Futu");
    expect(parsed.market_session).toBe("premarket_0915");
    expect(parsed.snapshot.positions_count).toBe(2);
    expect(parsed.snapshot.total_assets_range).toBe("100k-500k HKD");
    expect(parsed.report).toContain("今日盈亏：+400 HKD");
    expect(parsed.positions_summary.top_positions).toHaveLength(2);
    expect(result.commit).toBeUndefined();
  });

  it("sanitizes provider errors", async () => {
    const failingClient: FutuStockClient = {
      async healthCheck() {
        throw new Error("unused");
      },
      async getRawBrokerData() {
        throw new Error("token=abcabcabcabcabcabcabcabcabcabc should not leak");
      },
    };

    await expect(runFutuStockProvider({
      configName: "daily-stock-market",
      jobName: "stock-market-premarket",
      channelId: "channel",
      runAt: new Date("2026-05-07T01:15:00.000Z"),
    }, {
      client: failingClient,
      loadFutuConfig: () => futuConfig,
      loadProviderConfig: () => providerConfig,
    })).rejects.toThrow(/token=\[redacted\]/);
  });
});
