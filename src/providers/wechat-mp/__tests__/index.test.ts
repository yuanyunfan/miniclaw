import { describe, expect, it } from "vitest";
import type { PreProviderRunArgs } from "../../types.js";
import { runWechatMpProvider } from "../index.js";
import { WechatMpInvalidSessionError } from "../errors.js";
import type { WechatMpClient, WechatMpProviderConfig, WechatMpSession } from "../types.js";

function args(): PreProviderRunArgs {
  return {
    configName: "daily-ai-wechat",
    jobName: "daily-wechat-mp",
    channelId: "1000000000000000000",
    runAt: new Date("2026-05-10T06:00:00.000Z"),
  };
}

function config(): WechatMpProviderConfig {
  return {
    auth_path: "unused",
    state_path: "unused",
    window_hours: 24,
    max_pages_per_account: 1,
    page_size: 10,
    dedupe: true,
    accounts: [{ name: "机器之心", query: "机器之心" }],
  };
}

function session(): WechatMpSession {
  return {
    token: "123",
    cookies: [{ name: "session", value: "abc" }],
  };
}

describe("runWechatMpProvider", () => {
  it("skips the downstream cron task and asks the user to log in when session is invalid", async () => {
    const result = await runWechatMpProvider(args(), {
      loadConfig: () => config(),
      loadSession: () => session(),
      createClient: () => ({} as WechatMpClient),
      collect: async () => {
        throw new WechatMpInvalidSessionError("appmsgpublish: invalid session (200003 invalid session)");
      },
    });

    expect(result.skipTask?.reason).toBe("wechat_mp_session_invalid");
    expect(result.skipTask?.notifyMessage).toContain("微信公众号后台登录态已失效");
    expect(result.skipTask?.notifyMessage).toContain("pnpm wechat-mp:login -- --config daily-ai-wechat");
    expect(result.skipTask?.notifyMessage).toContain("pnpm wechat-mp:check -- --config daily-ai-wechat");

    const payload = JSON.parse(result.text) as Record<string, unknown>;
    expect(payload.status).toBe("skipped");
    expect(payload.skip_reason).toBe("wechat_mp_session_invalid");
    expect(payload.total_articles).toBe(0);
  });
});
