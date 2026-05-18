import { describe, expect, it, vi } from "vitest";
import {
  formatThirdPartyHealthIssueReport,
  runThirdPartyHealthCheck,
} from "../third-party-health.js";
import type { FutuStockClient, FutuStockConfig } from "../../mcp/futu-stock/types.js";
import type {
  EastmoneyJywgClient,
  EastmoneyJywgConfig,
  EastmoneyJywgSession,
} from "../../mcp/eastmoney-jywg/types.js";

const now = new Date("2026-05-10T12:00:00.000Z");

const futuConfig: FutuStockConfig = {
  profiles: {
    hk: {
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

const eastmoneyConfig: EastmoneyJywgConfig = {
  profiles: {
    default: {
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
    },
  },
};

const session: EastmoneyJywgSession = {
  version: 1,
  host: "jywg.18.cn",
  last_verified_at: "2026-05-10T11:00:00.000Z",
  cookies: [{ name: "sid", value: "secret-cookie" }],
};

function okFutuClient(): FutuStockClient {
  return {
    healthCheck: async (profile) => ({
      ok: true,
      opend: { ok: true, host: profile.opend_host, port: profile.opend_port },
      python: { ok: true, bin: profile.python_bin, futu_api_available: true },
    }),
    getRawBrokerData: async () => ({
      captured_at: "2026-05-10T12:00:01.000Z",
      account: {},
      positions: [{ code: "00700", stock_name: "Tencent", qty: 1 }],
    }),
  };
}

function okEastmoneyClient(): EastmoneyJywgClient {
  return {
    healthCheck: async () => ({
      ok: true,
      host: "jywg.18.cn",
      session: { ok: true, cookie_count: 1, last_verified_at: session.last_verified_at },
    }),
    getRawBrokerData: async () => ({
      captured_at: "2026-05-10T12:00:02.000Z",
      asset_and_position: { Status: 0, Data: [] },
      positions: { Status: 0, Data: [{ Zqdm: "600000", Zqmc: "浦发银行", Zqsl: "1" }] },
      updated_session: session,
      warnings: [],
    }),
  };
}

describe("third-party health check", () => {
  it("returns ok when Futu and Eastmoney read-only queries succeed", async () => {
    const saveEastmoneySession = vi.fn();
    const report = await runThirdPartyHealthCheck({
      now: () => now,
      loadFutuConfig: () => futuConfig,
      futuClient: okFutuClient(),
      loadEastmoneyConfig: () => eastmoneyConfig,
      eastmoneyClient: okEastmoneyClient(),
      loadEastmoneySession: () => session,
      saveEastmoneySession,
      includeExtendedChecks: false,
    });

    expect(report.ok).toBe(true);
    expect(report.checks).toHaveLength(2);
    expect(report.checks.map((check) => check.status)).toEqual(["ok", "ok"]);
    expect(report.checks.map((check) => check.positions_count)).toEqual([1, 1]);
    expect(formatThirdPartyHealthIssueReport(report)).toBe("");
    expect(saveEastmoneySession).toHaveBeenCalledOnce();
  });

  it("reports only failing connectors and redacts sensitive text", async () => {
    const report = await runThirdPartyHealthCheck({
      now: () => now,
      loadFutuConfig: () => futuConfig,
      futuClient: okFutuClient(),
      loadEastmoneyConfig: () => eastmoneyConfig,
      eastmoneyClient: {
        ...okEastmoneyClient(),
        healthCheck: async () => ({
          ok: false,
          host: "jywg.18.cn",
          session: {
            ok: false,
            cookie_count: 1,
            last_verified_at: session.last_verified_at,
            error: "Cookie: sid=secret; validatekey=abc123 redirected to login",
          },
        }),
      },
      loadEastmoneySession: () => session,
      saveEastmoneySession: vi.fn(),
      includeExtendedChecks: false,
    });

    expect(report.ok).toBe(false);
    const message = formatThirdPartyHealthIssueReport(report);
    expect(message).toContain("eastmoney-jywg/default");
    expect(message).toContain("pnpm eastmoney-jywg:login");
    expect(message).not.toContain("secret");
    expect(message).not.toContain("abc123");
    expect(message).not.toContain("futu-stock/hk");
  });

  it("includes extended provider health targets when enabled", async () => {
    const report = await runThirdPartyHealthCheck({
      now: () => now,
      loadFutuConfig: () => futuConfig,
      futuClient: okFutuClient(),
      loadEastmoneyConfig: () => eastmoneyConfig,
      eastmoneyClient: okEastmoneyClient(),
      loadEastmoneySession: () => session,
      saveEastmoneySession: vi.fn(),
      providerHealthTargets: [{ provider: "eastmoney-etf-premium", configName: "cn-stock" }],
      yahooConfigNames: [],
      wechatConfigNames: [],
      emailHealthTargets: [],
      marketIntelConfigNames: [],
      stockPortfolioConfigNames: [],
      runProviderHealthCheck: async () => ({
        ok: true,
        message: "eastmoney-etf-premium config ok: cn-stock",
        checkedAt: now.toISOString(),
        safeDetails: { symbols: ["159513"], has_premium_discount_ratio: true },
      }),
    });

    expect(report.ok).toBe(true);
    expect(report.checks).toHaveLength(3);
    expect(report.checks.at(-1)).toMatchObject({
      provider: "eastmoney-etf-premium",
      profile: "cn-stock",
      status: "ok",
      kind: "provider",
      stage: "health",
    });
  });

  it("reports extended provider failures and redacts secrets", async () => {
    const report = await runThirdPartyHealthCheck({
      now: () => now,
      loadFutuConfig: () => futuConfig,
      futuClient: okFutuClient(),
      loadEastmoneyConfig: () => eastmoneyConfig,
      eastmoneyClient: okEastmoneyClient(),
      loadEastmoneySession: () => session,
      saveEastmoneySession: vi.fn(),
      providerHealthTargets: [{ provider: "wechat-mp", configName: "daily-ai-wechat" }],
      yahooConfigNames: [],
      wechatConfigNames: [],
      emailHealthTargets: [],
      marketIntelConfigNames: [],
      stockPortfolioConfigNames: [],
      runProviderHealthCheck: async () => ({
        ok: false,
        category: "auth",
        message: "token=secret Cookie: sid=abc user@example.com validatekey=abc123",
        checkedAt: now.toISOString(),
      }),
    });

    expect(report.ok).toBe(false);
    const message = formatThirdPartyHealthIssueReport(report);
    expect(message).toContain("wechat-mp/daily-ai-wechat");
    expect(message).toContain("category=auth");
    expect(message).not.toContain("secret");
    expect(message).not.toContain("sid=abc");
    expect(message).not.toContain("user@example.com");
    expect(message).not.toContain("abc123");
  });
});
