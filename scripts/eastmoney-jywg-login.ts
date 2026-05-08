#!/usr/bin/env tsx
import { mkdirSync } from "node:fs";
import { loadEastmoneyJywgConfig, resolveEastmoneyJywgProfile } from "../src/mcp/eastmoney-jywg/config.js";
import { HttpEastmoneyJywgClient } from "../src/mcp/eastmoney-jywg/client.js";
import {
  filterJywgCookies,
  resolveHome,
  saveEastmoneyJywgSession,
} from "../src/mcp/eastmoney-jywg/session-vault.js";
import type { EastmoneyJywgCookie, EastmoneyJywgSession } from "../src/mcp/eastmoney-jywg/types.js";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function loadPlaywright(): Promise<{
  chromium: {
    launchPersistentContext: (userDataDir: string, options: Record<string, unknown>) => Promise<{
      newPage: () => Promise<{
        goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
      }>;
      storageState: () => Promise<{ cookies: EastmoneyJywgCookie[] }>;
      close: () => Promise<void>;
    }>;
  };
}> {
  try {
    return await import("playwright") as unknown as {
      chromium: {
        launchPersistentContext: (userDataDir: string, options: Record<string, unknown>) => Promise<{
          newPage: () => Promise<{
            goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
          }>;
          storageState: () => Promise<{ cookies: EastmoneyJywgCookie[] }>;
          close: () => Promise<void>;
        }>;
      };
    };
  } catch {
    throw new Error("playwright is not installed. Run `pnpm install`, then retry `pnpm eastmoney-jywg:login`.");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSession(profileName: string, cookies: EastmoneyJywgCookie[]): EastmoneyJywgSession {
  const now = new Date().toISOString();
  return {
    version: 1,
    profile: profileName,
    host: "jywg.18.cn",
    created_at: now,
    last_verified_at: now,
    source: "visible-browser-bootstrap",
    cookies: filterJywgCookies(cookies),
    fingerprint: {
      login_url: "https://jywg.18.cn/Login?el=1&clear=&returl=%2fTrade%2fBuy",
      trade_url: "https://jywg.18.cn/Trade/Buy",
    },
  };
}

const profileName = argValue("profile") ?? "default";
const timeoutMs = Number(argValue("timeout-ms") ?? "300000");
const checkIntervalMs = Number(argValue("check-interval-ms") ?? "2500");
const config = loadEastmoneyJywgConfig();
const profile = resolveEastmoneyJywgProfile(config, profileName);
const browserProfileDir = resolveHome(profile.browser_profile_dir);
mkdirSync(browserProfileDir, { recursive: true });

const { chromium } = await loadPlaywright();
const launchOptions: Record<string, unknown> = {
  headless: false,
  acceptDownloads: false,
};
if (process.env.MINICLAW_EASTMONEY_JYWG_BROWSER_CHANNEL) {
  launchOptions.channel = process.env.MINICLAW_EASTMONEY_JYWG_BROWSER_CHANNEL;
}

const context = await chromium.launchPersistentContext(browserProfileDir, launchOptions);
const client = new HttpEastmoneyJywgClient();

try {
  const page = await context.newPage();
  await page.goto("https://jywg.18.cn/Trade/Buy", { waitUntil: "domcontentloaded" });
  console.log("Visible browser opened for Eastmoney jywg. Complete login manually in the browser window.");
  console.log("MiniClaw will save only jywg.18.cn cookies after a read-only health check succeeds.");

  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  let saved = false;
  while (Date.now() < deadline) {
    const storage = await context.storageState();
    const session = buildSession(profileName, storage.cookies);
    if (session.cookies.length) {
      const health = await client.healthCheck(profile, session);
      if (health.ok) {
        saveEastmoneyJywgSession(profile.session_secret_path, session);
        console.log(`eastmoney-jywg session saved. cookie_count=${session.cookies.length}; path=${resolveHome(profile.session_secret_path)}`);
        saved = true;
        break;
      }
      lastError = health.session.error ?? "";
    }
    await sleep(checkIntervalMs);
  }
  if (!saved) throw new Error(`timed out waiting for Eastmoney jywg login health check${lastError ? `: ${lastError}` : ""}`);
} finally {
  await context.close();
}
