#!/usr/bin/env tsx
import { loadWechatMpProviderConfig } from "../src/providers/wechat-mp/config.js";
import { saveWechatMpSession } from "../src/providers/wechat-mp/auth.js";
import { refreshWechatMpBrowserSession } from "../src/providers/wechat-mp/browser-refresh.js";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const configName = argValue("config") ?? "default";
const checkQuery = argValue("check-query");
const timeoutMs = Number(argValue("timeout-ms") ?? "300000");
const cfg = loadWechatMpProviderConfig(configName);

console.log("Visible browser opened. Scan/confirm login in WeChat if needed, then wait for the official account backend to load.");
const session = await refreshWechatMpBrowserSession(cfg, {
  headless: false,
  timeoutMs,
  checkQuery,
});
saveWechatMpSession(cfg.auth_path, session);
console.log(`wechat-mp session saved. cookie_count=${session.cookies.length}; profile_dir=${cfg.browser_profile_dir}`);
