import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import type { EastmoneyJywgConfig, EastmoneyJywgProfileConfig, EastmoneyJywgRedactionLevel } from "./types.js";
import { resolveHome } from "./session-vault.js";
import { assertSafeBaseUrl } from "./safety.js";

const DEFAULT_CONFIG_PATH = "~/.miniclaw/providers/eastmoney-jywg-readonly/config.yaml";
const DEFAULT_SECRET_PATH = "~/.miniclaw/secrets/eastmoney-jywg-session.json";
const DEFAULT_BROWSER_PROFILE_DIR = "~/.miniclaw/browser-profiles/eastmoney-jywg";
const DEFAULT_SNAPSHOT_DIR = "~/.miniclaw/providers/eastmoney-jywg-readonly/snapshots";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function nonNegativeInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return fallback;
  return Math.min(value, max);
}

function redactionValue(value: unknown, fallback: EastmoneyJywgRedactionLevel): EastmoneyJywgRedactionLevel {
  return value === "summary" || value === "exact" ? value : fallback;
}

function baseUrlValue(value: unknown): "https://jywg.18.cn" {
  const baseUrl = stringValue(value, "https://jywg.18.cn");
  if (baseUrl !== "https://jywg.18.cn") {
    throw new Error("eastmoney-jywg base_url must be exactly https://jywg.18.cn");
  }
  return baseUrl;
}

function parseProfile(raw: unknown, name: string): EastmoneyJywgProfileConfig {
  if (!isPlainObject(raw)) {
    throw new Error(`eastmoney-jywg profile '${name}' must be a YAML object`);
  }
  const profile: EastmoneyJywgProfileConfig = {
    account_alias: stringValue(raw.account_alias, name),
    base_url: baseUrlValue(raw.base_url),
    session_secret_path: stringValue(raw.session_secret_path, DEFAULT_SECRET_PATH),
    browser_profile_dir: stringValue(raw.browser_profile_dir, DEFAULT_BROWSER_PROFILE_DIR),
    snapshot_dir: stringValue(raw.snapshot_dir, DEFAULT_SNAPSHOT_DIR),
    redaction: redactionValue(raw.redaction, "summary"),
    top_positions_limit: nonNegativeInt(raw.top_positions_limit, 8, 20),
    include_orders: boolValue(raw.include_orders, false),
    include_deals: boolValue(raw.include_deals, false),
    allow_non_jywg_host: boolValue(raw.allow_non_jywg_host, false),
    fail_on_login_challenge: boolValue(raw.fail_on_login_challenge, true),
    show_total_assets: boolValue(raw.show_total_assets, false),
  };
  assertSafeBaseUrl(profile);
  return profile;
}

function defaultConfig(): EastmoneyJywgConfig {
  return {
    profiles: {
      default: parseProfile({}, "default"),
    },
  };
}

export function getEastmoneyJywgConfigPath(): string {
  return resolveHome(process.env.MINICLAW_EASTMONEY_JYWG_CONFIG ?? DEFAULT_CONFIG_PATH);
}

export function loadEastmoneyJywgConfig(path = getEastmoneyJywgConfigPath()): EastmoneyJywgConfig {
  if (!existsSync(path)) return defaultConfig();
  const raw = yamlLoad(readFileSync(path, "utf8"));
  if (!isPlainObject(raw)) throw new Error(`eastmoney-jywg config must be a YAML object: ${path}`);
  const rawProfiles = raw.profiles;
  if (!isPlainObject(rawProfiles)) throw new Error(`eastmoney-jywg config must include profiles: ${path}`);
  const profiles: Record<string, EastmoneyJywgProfileConfig> = {};
  for (const [name, profileRaw] of Object.entries(rawProfiles)) {
    const normalized = name.trim();
    if (!normalized || normalized.includes("/") || normalized.includes("..")) {
      throw new Error("eastmoney-jywg profile names must not be empty or include path separators");
    }
    profiles[normalized] = parseProfile(profileRaw, normalized);
  }
  if (!Object.keys(profiles).length) throw new Error(`eastmoney-jywg config must include at least one profile: ${path}`);
  return { profiles };
}

export function resolveEastmoneyJywgProfile(
  config: EastmoneyJywgConfig,
  name = "default",
  overrides?: { account_alias?: string; redaction?: EastmoneyJywgRedactionLevel },
): EastmoneyJywgProfileConfig {
  const profileName = name.trim() || "default";
  const profile = config.profiles[profileName];
  if (!profile) throw new Error(`unknown eastmoney-jywg profile: ${profileName}`);
  return {
    ...profile,
    account_alias: overrides?.account_alias?.trim() || profile.account_alias,
    redaction: overrides?.redaction ?? profile.redaction,
  };
}

export const __testables = {
  DEFAULT_CONFIG_PATH,
  DEFAULT_SECRET_PATH,
  DEFAULT_BROWSER_PROFILE_DIR,
  DEFAULT_SNAPSHOT_DIR,
  home: homedir,
};
