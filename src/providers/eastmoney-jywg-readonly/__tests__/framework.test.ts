import { describe, expect, it } from "vitest";
import { createEastmoneyJywgProvider, runEastmoneyJywgProvider } from "../index.js";
import type {
  EastmoneyJywgClient,
  EastmoneyJywgConfig,
  EastmoneyJywgHealthCheck,
  EastmoneyJywgRawBrokerData,
  EastmoneyJywgSession,
} from "../../../mcp/eastmoney-jywg/types.js";
import type { EastmoneyJywgProviderConfig } from "../types.js";

const session: EastmoneyJywgSession = {
  version: 1,
  host: "jywg.18.cn",
  last_verified_at: "2026-05-08T07:16:00.000Z",
  cookies: [{ name: "sid", value: "secret-cookie-value", domain: ".18.cn", path: "/" }],
};

function eastmoneyConfig(): EastmoneyJywgConfig {
  return {
    profiles: {
      default: {
        account_alias: "Sensitive Eastmoney Alias",
        base_url: "https://jywg.18.cn",
        session_secret_path: "/tmp/eastmoney-session.json",
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
  account_alias: "Sensitive Eastmoney Alias",
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
    last_verified_at: "2026-05-08T07:17:00.000Z",
    cookies: [{ name: "sid", value: "new-secret-cookie-value", domain: ".18.cn", path: "/" }],
  },
  warnings: ["account=123456789012 cookie=secret-cookie-value should be redacted"],
};

function deps(client: EastmoneyJywgClient, saveSession?: (path: string, updated: EastmoneyJywgSession) => void) {
  return {
    client,
    loadEastmoneyConfig: eastmoneyConfig,
    loadProviderConfig: () => providerConfig,
    loadSession: () => session,
    saveSession,
  };
}

describe("eastmoney-jywg provider framework lifecycle", () => {
  it("health-checks session reachability without leaking alias or cookies", async () => {
    let rawQueried = false;
    const provider = createEastmoneyJywgProvider(deps({
      async healthCheck(): Promise<EastmoneyJywgHealthCheck> {
        return { ok: true, host: "jywg.18.cn", session: { ok: true, cookie_count: 1 } };
      },
      async getRawBrokerData() {
        rawQueried = true;
        return raw;
      },
    }));

    const health = await provider.healthCheck?.({
      configName: "daily-stock-market",
      jobName: "stock-market-premarket",
      channelId: "channel",
      runAt: new Date("2026-05-08T01:15:00.000Z"),
    });

    expect(health).toMatchObject({
      ok: true,
      message: "eastmoney-jywg-readonly profile default is reachable",
      safeDetails: {
        profile: "default",
        account_alias_present: true,
        market_session: "premarket_0915",
        redaction: "summary",
      },
    });
    expect(JSON.stringify(health)).not.toContain("Sensitive Eastmoney Alias");
    expect(JSON.stringify(health)).not.toContain("secret-cookie-value");
    expect(rawQueried).toBe(false);
  });

  it("dry-runs with a redacted summary and does not save the updated session", async () => {
    let sessionSaved = false;
    const provider = createEastmoneyJywgProvider(deps({
      async healthCheck(): Promise<EastmoneyJywgHealthCheck> {
        return { ok: true, host: "jywg.18.cn", session: { ok: true, cookie_count: 1 } };
      },
      async getRawBrokerData() {
        return raw;
      },
    }, () => {
      sessionSaved = true;
    }));

    const result = await provider.dryRun?.({
      configName: "daily-stock-market",
      jobName: "stock-market-premarket",
      channelId: "channel",
      runAt: new Date("2026-05-08T01:15:00.000Z"),
    });

    expect(result).toMatchObject({
      ok: true,
      redacted: true,
      structured: {
        source: "eastmoney-jywg-readonly",
        profile: "default",
        market_session: "premarket_0915",
        positions_count: 2,
        top_positions_count: 2,
        warning_count: 2,
      },
      warnings: expect.arrayContaining(["account=[redacted] cookie=[redacted] should be redacted"]),
    });
    expect(result?.previewText).not.toContain("Sensitive Eastmoney Alias");
    expect(result?.previewText).not.toContain("浦发银行");
    expect(result?.previewText).not.toContain("secret-cookie-value");
    expect(sessionSaved).toBe(false);
  });

  it("categorizes health failures without leaking sensitive error text", async () => {
    const provider = createEastmoneyJywgProvider(deps({
      async healthCheck(): Promise<EastmoneyJywgHealthCheck> {
        return {
          ok: false,
          host: "jywg.18.cn",
          session: {
            ok: false,
            cookie_count: 1,
            error: "session cookie=secret-cookie-value validatekey=abcdefghijklmnopqrstuvwxyz expired",
          },
        };
      },
      async getRawBrokerData() {
        return raw;
      },
    }));

    const health = await provider.healthCheck?.({
      configName: "daily-stock-market",
      jobName: "stock-market-premarket",
      channelId: "channel",
      runAt: new Date("2026-05-08T01:15:00.000Z"),
    });

    expect(health).toMatchObject({
      ok: false,
      category: "auth",
    });
    expect(health?.message).toContain("cookie=[redacted]");
    expect(health?.message).toContain("validatekey=[redacted]");
    expect(health?.message).not.toContain("secret-cookie-value");
    expect(health?.message).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("keeps session persistence delayed until the compatibility commit runs", async () => {
    let savedSession: EastmoneyJywgSession | undefined;
    const result = await runEastmoneyJywgProvider({
      configName: "daily-stock-market",
      jobName: "stock-market-premarket",
      channelId: "channel",
      runAt: new Date("2026-05-08T01:15:00.000Z"),
    }, deps({
      async healthCheck(): Promise<EastmoneyJywgHealthCheck> {
        return { ok: true, host: "jywg.18.cn", session: { ok: true, cookie_count: 1 } };
      },
      async getRawBrokerData() {
        return raw;
      },
    }, (_path, updated) => {
      savedSession = updated;
    }));

    expect(JSON.parse(result.text).positions_summary.positions_count).toBe(2);
    expect(savedSession).toBeUndefined();
    await result.commit?.();
    expect(savedSession?.last_verified_at).toBe("2026-05-08T07:17:00.000Z");
  });
});
