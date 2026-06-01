import { describe, expect, it, vi } from "vitest";
import {
  formatAuthSessionRefreshResults,
  runAuthSessionRefresh,
  runEastmoneyJywgSessionRefresh,
  runWechatMpSessionRefresh,
} from "../auth-session-refresh.js";
import { WechatMpInvalidSessionError } from "../../providers/wechat-mp/errors.js";
import type { WechatMpProviderConfig, WechatMpSession } from "../../providers/wechat-mp/types.js";
import type {
  EastmoneyJywgConfig,
  EastmoneyJywgProfileConfig,
  EastmoneyJywgSession,
} from "../../mcp/eastmoney-jywg/types.js";

const now = new Date("2026-05-19T00:00:00.000Z");

const wechatConfig: WechatMpProviderConfig = {
  auth_path: "~/.miniclaw/secrets/wechat-mp-session.json",
  browser_profile_dir: "~/.miniclaw/browser-profiles/wechat-mp",
  state_path: "~/.miniclaw/providers/wechat-mp/state.json",
  window_hours: 24,
  window: { mode: "relative", hours: 24 },
  max_pages_per_account: 1,
  page_size: 10,
  dedupe: true,
  read_filter: {
    enabled: false,
    min_title_score: 55,
    max_articles_to_fetch: 5,
    excerpt_chars: 2600,
    fetch_timeout_ms: 15_000,
  },
  accounts: [{ name: "阿里云开发者", query: "阿里云开发者" }],
};

const wechatSession: WechatMpSession = {
  token: "123456",
  cookies: [{ name: "slave_sid", value: "secret", domain: "mp.weixin.qq.com" }],
  saved_at: now.toISOString(),
};

const eastmoneyProfile: EastmoneyJywgProfileConfig = {
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

const eastmoneyConfig: EastmoneyJywgConfig = {
  profiles: {
    default: eastmoneyProfile,
  },
};

const eastmoneySession: EastmoneyJywgSession = {
  version: 1,
  host: "jywg.18.cn",
  last_verified_at: "2026-05-18T00:00:00.000Z",
  cookies: [{ name: "sid", value: "old", domain: ".18.cn" }],
};

describe("auth session refresh", () => {
  it("refreshes a WeChat MP browser-profile session and saves only redacted metadata in the result", async () => {
    const saveWechatSession = vi.fn();
    const result = await runWechatMpSessionRefresh("daily-ai-wechat", { now: () => now }, {
      loadWechatConfig: () => wechatConfig,
      refreshWechatBrowserSession: async () => wechatSession,
      saveWechatSession,
    });

    expect(result).toMatchObject({
      provider: "wechat-mp",
      profile: "daily-ai-wechat",
      status: "refreshed",
      cookie_count: 1,
    });
    expect(saveWechatSession).toHaveBeenCalledWith(wechatConfig.auth_path, wechatSession);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("123456");
  });

  it("reports manual WeChat re-authentication without writing a broken session", async () => {
    const saveWechatSession = vi.fn();
    const result = await runWechatMpSessionRefresh("daily-ai-wechat", { now: () => now }, {
      loadWechatConfig: () => wechatConfig,
      refreshWechatBrowserSession: async () => {
        throw new WechatMpInvalidSessionError("wechat mp browser profile requires visible re-authentication");
      },
      saveWechatSession,
    });

    expect(result.status).toBe("manual_required");
    expect(result.action).toContain("wechat-mp:refresh");
    expect(saveWechatSession).not.toHaveBeenCalled();
  });

  it("refreshes Eastmoney JYWG through the lightweight client method", async () => {
    const refreshed = { ...eastmoneySession, last_verified_at: now.toISOString(), cookies: [{ name: "sid", value: "new" }] };
    const saveEastmoneySession = vi.fn();
    const refreshSession = vi.fn(async () => refreshed);

    const results = await runEastmoneyJywgSessionRefresh(["default"], { now: () => now }, {
      loadEastmoneyConfig: () => eastmoneyConfig,
      loadEastmoneySession: () => eastmoneySession,
      saveEastmoneySession,
      eastmoneyClient: {
        healthCheck: async () => ({ ok: true, host: "jywg.18.cn", session: { ok: true, cookie_count: 1 } }),
        refreshSession,
        getRawBrokerData: async () => {
          throw new Error("getRawBrokerData should not be called");
        },
      },
    });

    expect(results[0]).toMatchObject({
      provider: "eastmoney-jywg",
      profile: "default",
      status: "refreshed",
      cookie_count: 1,
      last_verified_at: now.toISOString(),
    });
    expect(refreshSession).toHaveBeenCalledOnce();
    expect(saveEastmoneySession).toHaveBeenCalledWith(eastmoneyProfile.session_secret_path, refreshed);
    expect(JSON.stringify(results[0])).not.toContain("old");
    expect(JSON.stringify(results[0])).not.toContain("new");
  });

  it("runs both default refresh families and formats action hints", async () => {
    const results = await runAuthSessionRefresh({ now: () => now }, {
      loadEastmoneyConfig: () => eastmoneyConfig,
      loadEastmoneySession: () => eastmoneySession,
      saveEastmoneySession: vi.fn(),
      eastmoneyClient: {
        healthCheck: async () => ({ ok: true, host: "jywg.18.cn", session: { ok: true, cookie_count: 1 } }),
        refreshSession: async () => ({ ...eastmoneySession, last_verified_at: now.toISOString() }),
        getRawBrokerData: async () => {
          throw new Error("not used");
        },
      },
      loadWechatConfig: () => wechatConfig,
      refreshWechatBrowserSession: async () => {
        throw new WechatMpInvalidSessionError("visible re-authentication required");
      },
      saveWechatSession: vi.fn(),
    });

    expect(results.map((item) => `${item.provider}:${item.status}`)).toEqual([
      "eastmoney-jywg:refreshed",
      "wechat-mp:manual_required",
    ]);
    expect(formatAuthSessionRefreshResults(results)).toContain("action=pnpm wechat-mp:refresh");
  });
});
