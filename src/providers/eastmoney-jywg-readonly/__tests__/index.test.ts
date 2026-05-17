import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runEastmoneyJywgProvider } from "../index.js";
import { saveEastmoneyJywgSession } from "../../../mcp/eastmoney-jywg/session-vault.js";
import type {
  EastmoneyJywgClient,
  EastmoneyJywgConfig,
  EastmoneyJywgHealthCheck,
  EastmoneyJywgRawBrokerData,
} from "../../../mcp/eastmoney-jywg/types.js";
import type { EastmoneyJywgProviderConfig } from "../../../stock/reports/eastmoney-jywg-readonly-types.js";

let tmp: string;
let sessionPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-eastmoney-provider-"));
  sessionPath = join(tmp, "session.json");
  saveEastmoneyJywgSession(sessionPath, {
    version: 1,
    host: "jywg.18.cn",
    cookies: [{ name: "sid", value: "abc", domain: ".18.cn", path: "/" }],
  });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function eastmoneyConfig(): EastmoneyJywgConfig {
  return {
    profiles: {
      default: {
        account_alias: "Eastmoney A",
        base_url: "https://jywg.18.cn",
        session_secret_path: sessionPath,
        browser_profile_dir: "~/.miniclaw/browser-profiles/eastmoney-jywg",
        snapshot_dir: "~/.miniclaw/providers/eastmoney-jywg-readonly/snapshots",
        redaction: "summary",
        top_positions_limit: 8,
        include_orders: false,
        include_deals: false,
        allow_non_jywg_host: false,
        fail_on_login_challenge: true,
        show_total_assets: false,
      },
    },
  };
}

const providerConfig: EastmoneyJywgProviderConfig = {
  profile: "default",
  account_alias: "Eastmoney Daily",
  market_session_by_job: {
    "stock-market-premarket": "premarket_0915",
  },
  redaction: "summary",
  top_positions_limit: 2,
  include_account_snapshot: true,
  include_daily_report: true,
  include_positions_summary: true,
  include_asset_allocation: false,
  asset_gap_policy: { positive_market_value_gap: "unclassified" },
};

const raw: EastmoneyJywgRawBrokerData = {
  captured_at: "2026-05-08T07:15:00.000Z",
  asset_and_position: { Status: 0, Data: [{ Zzc: "101000", Zxsz: "80000", Kyzj: "21000" }] },
  positions: {
    Status: 0,
    Data: [
      { Zqdm: "600000", Zqmc: "浦发银行", Zqsl: "1000", Zxjg: "10", Drckyk: "500", Ykbl: "1.2" },
      { Zqdm: "000001", Zqmc: "平安银行", Zqsl: "500", Zxjg: "8", Drckyk: "-100", Ykbl: "-0.8" },
    ],
  },
  updated_session: {
    version: 1,
    host: "jywg.18.cn",
    last_verified_at: "2026-05-08T07:16:00.000Z",
    cookies: [{ name: "sid", value: "new", domain: ".18.cn", path: "/" }],
  },
  warnings: [],
};

const client: EastmoneyJywgClient = {
  async healthCheck(): Promise<EastmoneyJywgHealthCheck> {
    return { ok: true, host: "jywg.18.cn", session: { ok: true, cookie_count: 1 } };
  },
  async getRawBrokerData() {
    return raw;
  },
};

describe("runEastmoneyJywgProvider", () => {
  it("returns parseable redacted account context with an injected client", async () => {
    const result = await runEastmoneyJywgProvider({
      configName: "daily-stock-market",
      jobName: "stock-market-premarket",
      channelId: "channel",
      runAt: new Date("2026-05-08T01:15:00.000Z"),
    }, {
      client,
      loadEastmoneyConfig: eastmoneyConfig,
      loadProviderConfig: () => providerConfig,
    });

    const parsed = JSON.parse(result.text);

    expect(parsed.account_alias).toBe("Eastmoney Daily");
    expect(parsed.market_session).toBe("premarket_0915");
    expect(parsed.snapshot.positions_count).toBe(2);
    expect(parsed.snapshot.total_assets_range).toBe("100k-500k CNY");
    expect(parsed.report).toContain("今日盈亏：+400 CNY");
    expect(parsed.positions_summary.top_positions).toHaveLength(2);
    expect(result.commit).toBeTypeOf("function");
    await result.commit?.();
  });

  it("sanitizes provider errors", async () => {
    const failingClient: EastmoneyJywgClient = {
      async healthCheck(): Promise<EastmoneyJywgHealthCheck> {
        throw new Error("unused");
      },
      async getRawBrokerData() {
        throw new Error("cookie=abcabcabcabcabcabcabcabcabcabc should not leak");
      },
    };

    await expect(runEastmoneyJywgProvider({
      configName: "daily-stock-market",
      jobName: "stock-market-premarket",
      channelId: "channel",
      runAt: new Date("2026-05-08T01:15:00.000Z"),
    }, {
      client: failingClient,
      loadEastmoneyConfig: eastmoneyConfig,
      loadProviderConfig: () => providerConfig,
    })).rejects.toThrow(/cookie=\[redacted\]/);
  });
});
