#!/usr/bin/env tsx
import {
  formatAuthSessionRefreshResults,
  runAuthSessionRefresh,
  type AuthSessionRefreshProvider,
} from "../src/ops/auth-session-refresh.js";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function providersArg(): AuthSessionRefreshProvider[] | undefined {
  const raw = argValue("provider");
  if (!raw) return undefined;
  const providers = raw.split(",").map((item) => item.trim()).filter(Boolean);
  for (const provider of providers) {
    if (provider !== "wechat-mp" && provider !== "eastmoney-jywg") {
      throw new Error(`unsupported auth refresh provider: ${provider}`);
    }
  }
  return providers as AuthSessionRefreshProvider[];
}

const wechatConfig = argValue("config");
const eastmoneyProfile = argValue("profile");
const timeoutMs = Number(argValue("timeout-ms") ?? "30000");

const results = await runAuthSessionRefresh({
  providers: providersArg(),
  wechatConfigNames: wechatConfig ? [wechatConfig] : undefined,
  eastmoneyProfiles: eastmoneyProfile ? [eastmoneyProfile] : undefined,
  headless: !hasArg("--visible"),
  timeoutMs,
  checkQuery: argValue("check-query"),
});

if (hasArg("--json")) {
  console.log(JSON.stringify({ ok: results.every((item) => item.status === "refreshed"), results }, null, 2));
} else {
  console.log(formatAuthSessionRefreshResults(results));
}

if (results.some((item) => item.status !== "refreshed")) {
  process.exit(1);
}
