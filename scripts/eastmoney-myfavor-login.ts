#!/usr/bin/env tsx
import { mkdirSync } from "node:fs";
import { HttpEastmoneyMyfavorClient } from "../src/mcp/eastmoney-myfavor/client.js";
import { loadEastmoneyMyfavorConfig, resolveEastmoneyMyfavorProfile } from "../src/mcp/eastmoney-myfavor/config.js";
import {
  filterMyfavorCookies,
  saveEastmoneyMyfavorSession,
} from "../src/mcp/eastmoney-myfavor/session-vault.js";
import type { EastmoneyMyfavorCookie, EastmoneyMyfavorSession } from "../src/mcp/eastmoney-myfavor/types.js";

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
      storageState: () => Promise<{ cookies: EastmoneyMyfavorCookie[] }>;
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
          storageState: () => Promise<{ cookies: EastmoneyMyfavorCookie[] }>;
          close: () => Promise<void>;
        }>;
      };
    };
  } catch {
    throw new Error("playwright is not installed. Run `pnpm install`, then retry `pnpm eastmoney-myfavor:login`.");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function shouldForceDirectBrowserProxy(): boolean {
  return envFlag("MINICLAW_BROWSER_FORCE_DIRECT") ||
    envFlag("MINICLAW_EASTMONEY_BROWSER_FORCE_DIRECT") ||
    envFlag("MINICLAW_EASTMONEY_MYFAVOR_BROWSER_FORCE_DIRECT");
}

function buildSession(profileName: string, cookies: EastmoneyMyfavorCookie[]): EastmoneyMyfavorSession {
  const now = new Date().toISOString();
  return {
    version: 1,
    profile: profileName,
    host: "myfavor.eastmoney.com",
    created_at: now,
    last_verified_at: now,
    source: "visible-browser-bootstrap",
    cookies: filterMyfavorCookies(cookies),
    fingerprint: {
      login_url: "https://quote.eastmoney.com/zixuan/",
      api_url: "https://myfavor.eastmoney.com/v4/webouter/ggdefstkindexinfos",
    },
  };
}

const profileName = argValue("profile") ?? "default";
const timeoutMs = Number(argValue("timeout-ms") ?? "300000");
const checkIntervalMs = Number(argValue("check-interval-ms") ?? "2500");
const config = loadEastmoneyMyfavorConfig();
const profile = resolveEastmoneyMyfavorProfile(config, profileName);
mkdirSync(profile.browser_profile_dir, { recursive: true });

const { chromium } = await loadPlaywright();
const launchOptions: Record<string, unknown> = {
  headless: false,
  acceptDownloads: false,
};
if (process.env.MINICLAW_EASTMONEY_MYFAVOR_BROWSER_CHANNEL) {
  launchOptions.channel = process.env.MINICLAW_EASTMONEY_MYFAVOR_BROWSER_CHANNEL;
}
if (shouldForceDirectBrowserProxy()) {
  launchOptions.args = ["--proxy-server=direct://", "--proxy-bypass-list=*"];
}

const context = await chromium.launchPersistentContext(profile.browser_profile_dir, launchOptions);
const client = new HttpEastmoneyMyfavorClient();

try {
  const page = await context.newPage();
  await page.goto("https://quote.eastmoney.com/zixuan/", { waitUntil: "domcontentloaded" });
  console.log("Visible browser opened for Eastmoney myfavor. Complete login manually in the browser window.");
  console.log("MiniClaw will save only Eastmoney myfavor cookies after a read-only group-list check succeeds.");

  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  let saved = false;
  while (Date.now() < deadline) {
    const storage = await context.storageState();
    const session = buildSession(profileName, storage.cookies);
    if (session.cookies.length) {
      try {
        const result = await client.getGroups(profile, session);
        if (result.groups.length) {
          saveEastmoneyMyfavorSession(profile.session_secret_path, result.session);
          console.log(`eastmoney-myfavor session saved. group_count=${result.groups.length}; cookie_count=${session.cookies.length}; path=${profile.session_secret_path}`);
          saved = true;
          break;
        }
        lastError = "group list is empty";
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    await sleep(checkIntervalMs);
  }
  if (!saved) throw new Error(`timed out waiting for Eastmoney myfavor login health check${lastError ? `: ${lastError}` : ""}`);
} finally {
  await context.close();
}
