#!/usr/bin/env tsx
import { loadWechatMpProviderConfig } from "../src/providers/wechat-mp/config.js";
import { saveWechatMpSession } from "../src/providers/wechat-mp/auth.js";
import { HttpWechatMpClient } from "../src/providers/wechat-mp/client.js";
import type { WechatMpCookie, WechatMpSession } from "../src/providers/wechat-mp/types.js";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function loadPlaywright(): Promise<{ chromium: { launch: (options: Record<string, unknown>) => Promise<unknown> } }> {
  try {
    return await import("playwright") as unknown as { chromium: { launch: (options: Record<string, unknown>) => Promise<unknown> } };
  } catch {
    throw new Error("playwright is not installed. Run `pnpm install` after this change, then retry `pnpm wechat-mp:login`.");
  }
}

function tokenFromUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    const token = url.searchParams.get("token");
    return token && /^\d+$/.test(token) ? token : undefined;
  } catch {
    return undefined;
  }
}

function filterMpCookies(cookies: WechatMpCookie[]): WechatMpCookie[] {
  return cookies.filter((cookie) => {
    const domain = cookie.domain ?? "";
    return domain.includes("mp.weixin.qq.com") || domain.includes("weixin.qq.com") || domain.includes("qq.com");
  });
}

const configName = argValue("config") ?? "default";
const checkQuery = argValue("check-query");
const timeoutMs = Number(argValue("timeout-ms") ?? "300000");
const cfg = loadWechatMpProviderConfig(configName);
const { chromium } = await loadPlaywright();

const launchOptions: Record<string, unknown> = { headless: false };
if (process.env.MINICLAW_WECHAT_MP_BROWSER_CHANNEL) {
  launchOptions.channel = process.env.MINICLAW_WECHAT_MP_BROWSER_CHANNEL;
}

const browser = await chromium.launch(launchOptions) as {
  newContext: () => Promise<{
    newPage: () => Promise<{
      goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
      waitForURL: (matcher: RegExp, options?: Record<string, unknown>) => Promise<unknown>;
      url: () => string;
    }>;
    storageState: () => Promise<{ cookies: WechatMpCookie[] }>;
  }>;
  close: () => Promise<void>;
};

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("https://mp.weixin.qq.com/", { waitUntil: "domcontentloaded" });
  console.log("Visible browser opened. Scan/confirm login in WeChat, then wait for the official account backend to load.");
  await page.waitForURL(/token=\d+/, { timeout: timeoutMs });

  const token = tokenFromUrl(page.url());
  if (!token) throw new Error("logged in page did not expose a numeric mp token");
  const storage = await context.storageState();
  const cookies = filterMpCookies(storage.cookies);
  const session: WechatMpSession = {
    token,
    cookies,
    saved_at: new Date().toISOString(),
    source_url: page.url().replace(/token=\d+/g, "token=<redacted>"),
  };

  const client = new HttpWechatMpClient(session);
  const query = checkQuery ?? cfg.accounts[0]?.query ?? "阿里云开发者";
  const found = await client.searchBiz(query);
  if (!found.length) throw new Error(`login health check returned no search result for query: ${query}`);

  saveWechatMpSession(cfg.auth_path, session);
  console.log(`wechat-mp session saved. cookie_count=${cookies.length}; health_check_results=${found.length}`);
} finally {
  await browser.close();
}
