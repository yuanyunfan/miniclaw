import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  filterWechatMpCookies,
  resolveHome,
  tokenFromWechatMpUrl,
} from "./auth.js";
import { HttpWechatMpClient } from "./client.js";
import { WechatMpInvalidSessionError } from "./errors.js";
import type { WechatMpClient, WechatMpCookie, WechatMpProviderConfig, WechatMpSession } from "./types.js";

interface BrowserPage {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  waitForURL(matcher: RegExp, options?: Record<string, unknown>): Promise<unknown>;
  url(): string;
}

interface BrowserContext {
  newPage(): Promise<BrowserPage>;
  storageState(): Promise<{ cookies: WechatMpCookie[] }>;
  close(): Promise<void>;
}

interface ChromiumLike {
  launchPersistentContext(userDataDir: string, options: Record<string, unknown>): Promise<BrowserContext>;
}

export interface WechatMpBrowserRefreshOptions {
  chromium?: ChromiumLike;
  headless?: boolean;
  timeoutMs?: number;
  checkQuery?: string;
  channel?: string;
  now?: () => Date;
  createClient?: (session: WechatMpSession) => Pick<WechatMpClient, "searchBiz">;
}

async function loadChromium(): Promise<ChromiumLike> {
  try {
    const playwright = await import("playwright") as unknown as { chromium: ChromiumLike };
    return playwright.chromium;
  } catch {
    throw new Error("playwright is not installed. Run `pnpm install`, then retry the WeChat MP login/refresh command.");
  }
}

function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true });
  if (process.platform !== "win32") chmodSync(path, 0o700);
}

function browserProfileDir(config: WechatMpProviderConfig): string {
  return resolveHome(config.browser_profile_dir);
}

export async function refreshWechatMpBrowserSession(
  config: WechatMpProviderConfig,
  options: WechatMpBrowserRefreshOptions = {},
): Promise<WechatMpSession> {
  const profileDir = browserProfileDir(config);
  ensurePrivateDir(dirname(profileDir));
  ensurePrivateDir(profileDir);

  const chromium = options.chromium ?? await loadChromium();
  const launchOptions: Record<string, unknown> = {
    headless: options.headless ?? true,
    acceptDownloads: false,
  };
  const channel = options.channel ?? process.env.MINICLAW_WECHAT_MP_BROWSER_CHANNEL;
  if (channel) launchOptions.channel = channel;

  const context = await chromium.launchPersistentContext(profileDir, launchOptions);
  try {
    const page = await context.newPage();
    await page.goto("https://mp.weixin.qq.com/", { waitUntil: "domcontentloaded" });
    try {
      await page.waitForURL(/token=\d+/, { timeout: options.timeoutMs ?? 30_000 });
    } catch {
      throw new WechatMpInvalidSessionError("wechat mp browser profile requires visible re-authentication");
    }

    const token = tokenFromWechatMpUrl(page.url());
    if (!token) {
      throw new WechatMpInvalidSessionError("wechat mp logged-in page did not expose a numeric token");
    }

    const storage = await context.storageState();
    const cookies = filterWechatMpCookies(storage.cookies);
    const session: WechatMpSession = {
      token,
      cookies,
      saved_at: (options.now?.() ?? new Date()).toISOString(),
      source_url: page.url().replace(/token=\d+/g, "token=<redacted>"),
    };

    const client = options.createClient?.(session) ?? new HttpWechatMpClient(session);
    const query = options.checkQuery ?? config.accounts[0]?.query ?? "阿里云开发者";
    const found = await client.searchBiz(query);
    if (!found.length) {
      throw new Error(`wechat mp refresh health check returned no search result for query: ${query}`);
    }
    return session;
  } finally {
    await context.close();
  }
}
