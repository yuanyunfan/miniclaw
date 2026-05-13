import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import { resolveHome } from "./session-vault.js";
import type { EastmoneyMyfavorConfig, EastmoneyMyfavorProfileConfig } from "./types.js";

const CONFIG_PATH_DEFAULT = join(homedir(), ".miniclaw/providers/eastmoney-myfavor/config.yaml");
const DEFAULT_SESSION_SECRET_PATH = "~/.miniclaw/secrets/eastmoney-myfavor-session.json";
const DEFAULT_BROWSER_PROFILE_DIR = "~/.miniclaw/browser-profiles/eastmoney-myfavor";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown, fallback?: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (fallback !== undefined) return fallback;
  throw new Error("eastmoney-myfavor config string value is required");
}

function intValue(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("eastmoney-myfavor timeout_ms must be a positive integer");
  return parsed;
}

function configPath(): string {
  return process.env.MINICLAW_EASTMONEY_MYFAVOR_CONFIG ?? CONFIG_PATH_DEFAULT;
}

function parseProfile(raw: unknown): EastmoneyMyfavorProfileConfig {
  const obj = isRecord(raw) ? raw : {};
  return {
    account_alias: stringValue(obj.account_alias, "Eastmoney MyFavor"),
    base_url: stringValue(obj.base_url, "https://myfavor.eastmoney.com"),
    appkey: stringValue(obj.appkey, process.env.MINICLAW_EASTMONEY_MYFAVOR_APPKEY ?? ""),
    session_secret_path: stringValue(obj.session_secret_path, DEFAULT_SESSION_SECRET_PATH),
    browser_profile_dir: stringValue(obj.browser_profile_dir, DEFAULT_BROWSER_PROFILE_DIR),
    timeout_ms: intValue(obj.timeout_ms, 8000),
  };
}

export function loadEastmoneyMyfavorConfig(): EastmoneyMyfavorConfig {
  const path = configPath();
  if (!existsSync(path)) throw new Error(`eastmoney-myfavor config not found: ${path}`);
  const raw = yamlLoad(readFileSync(path, "utf8")) as unknown;
  if (!isRecord(raw) || !isRecord(raw.profiles)) throw new Error(`eastmoney-myfavor config must contain profiles: ${path}`);
  const profiles: Record<string, EastmoneyMyfavorProfileConfig> = {};
  for (const [name, profile] of Object.entries(raw.profiles)) {
    profiles[name] = parseProfile(profile);
  }
  return { profiles };
}

export function resolveEastmoneyMyfavorProfile(config: EastmoneyMyfavorConfig, name = "default"): EastmoneyMyfavorProfileConfig {
  const profile = config.profiles[name];
  if (!profile) throw new Error(`eastmoney-myfavor profile not found: ${name}`);
  return {
    ...profile,
    session_secret_path: resolveHome(profile.session_secret_path),
    browser_profile_dir: resolveHome(profile.browser_profile_dir),
  };
}
