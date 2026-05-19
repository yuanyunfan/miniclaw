import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { refreshWechatMpBrowserSession } from "../browser-refresh.js";
import type { WechatMpProviderConfig } from "../types.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-wechat-refresh-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function config(): WechatMpProviderConfig {
  return {
    auth_path: join(tmp, "session.json"),
    browser_profile_dir: join(tmp, "profile"),
    state_path: join(tmp, "state.json"),
    window_hours: 24,
    window: { mode: "relative", hours: 24 },
    max_pages_per_account: 1,
    page_size: 10,
    dedupe: true,
    accounts: [{ name: "阿里云开发者", query: "阿里云开发者" }],
  };
}

describe("refreshWechatMpBrowserSession", () => {
  it("uses a persistent browser profile and returns a verified session", async () => {
    let launchedDir = "";
    let closed = false;
    const session = await refreshWechatMpBrowserSession(config(), {
      chromium: {
        async launchPersistentContext(userDataDir) {
          launchedDir = userDataDir;
          return {
            async newPage() {
              return {
                async goto() {},
                async waitForURL() {},
                url: () => "https://mp.weixin.qq.com/cgi-bin/home?token=123456",
              };
            },
            async storageState() {
              return {
                cookies: [
                  { name: "slave_sid", value: "sid", domain: "mp.weixin.qq.com" },
                  { name: "other", value: "nope", domain: "example.com" },
                ],
              };
            },
            async close() {
              closed = true;
            },
          };
        },
      },
      now: () => new Date("2026-05-19T00:00:00.000Z"),
      createClient: () => ({ searchBiz: async () => [{ fakeid: "fake" }] }),
    });

    expect(launchedDir).toBe(join(tmp, "profile"));
    expect(closed).toBe(true);
    expect(session.token).toBe("123456");
    expect(session.saved_at).toBe("2026-05-19T00:00:00.000Z");
    expect(session.cookies.map((cookie) => cookie.name)).toEqual(["slave_sid"]);
  });

  it("requires visible re-authentication when the profile cannot reach a token page", async () => {
    await expect(refreshWechatMpBrowserSession(config(), {
      chromium: {
        async launchPersistentContext() {
          return {
            async newPage() {
              return {
                async goto() {},
                async waitForURL() {
                  throw new Error("timeout");
                },
                url: () => "https://mp.weixin.qq.com/",
              };
            },
            async storageState() {
              return { cookies: [] };
            },
            async close() {},
          };
        },
      },
      createClient: () => ({ searchBiz: async () => [] }),
    })).rejects.toThrow(/visible re-authentication/);
  });
});
