import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { load as yamlLoad } from "js-yaml";
import type { FutuRedactionLevel, FutuStockConfig, FutuStockProfileConfig } from "./types.js";

const DEFAULT_CONFIG_PATH = "~/.miniclaw/providers/futu-stock/config.yaml";
const DEFAULT_SNAPSHOT_DIR = "~/.miniclaw/providers/futu-stock/snapshots";

function resolveHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return resolve(path);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function portValue(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > 65535) {
    return fallback;
  }
  return value;
}

function optionalNonNegativeInt(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("futu-stock profile acc_index must be a non-negative integer");
  }
  return value;
}

function redactionValue(value: unknown, fallback: FutuRedactionLevel): FutuRedactionLevel {
  if (value === "summary" || value === "exact") return value;
  return fallback;
}

function parseProfile(raw: unknown, name: string): FutuStockProfileConfig {
  if (!isPlainObject(raw)) {
    throw new Error(`futu-stock profile '${name}' must be a YAML object`);
  }
  const accId = typeof raw.acc_id === "string" && raw.acc_id.trim() ? raw.acc_id.trim() : undefined;
  return {
    opend_host: stringValue(raw.opend_host, "127.0.0.1"),
    opend_port: portValue(raw.opend_port, 11111),
    account_alias: stringValue(raw.account_alias, name),
    currency: stringValue(raw.currency, "HKD"),
    redaction: redactionValue(raw.redaction, "summary"),
    snapshot_dir: stringValue(raw.snapshot_dir, DEFAULT_SNAPSHOT_DIR),
    python_bin: stringValue(raw.python_bin, "python3"),
    trd_market: stringValue(raw.trd_market, "HK"),
    security_firm: stringValue(raw.security_firm, "FUTUSECURITIES"),
    acc_index: optionalNonNegativeInt(raw.acc_index),
    acc_id: accId,
    allow_non_local_opend: boolValue(raw.allow_non_local_opend, false),
    show_total_assets: boolValue(raw.show_total_assets, false),
  };
}

function defaultConfig(): FutuStockConfig {
  return {
    profiles: {
      default: parseProfile({}, "default"),
    },
  };
}

export function getFutuStockConfigPath(): string {
  return resolveHome(process.env.MINICLAW_FUTU_STOCK_CONFIG ?? DEFAULT_CONFIG_PATH);
}

export function loadFutuStockConfig(path = getFutuStockConfigPath()): FutuStockConfig {
  if (!existsSync(path)) return defaultConfig();
  const raw = yamlLoad(readFileSync(path, "utf8"));
  if (!isPlainObject(raw)) throw new Error(`futu-stock config must be a YAML object: ${path}`);
  const rawProfiles = raw.profiles;
  if (!isPlainObject(rawProfiles)) throw new Error(`futu-stock config must include profiles: ${path}`);
  const profiles: Record<string, FutuStockProfileConfig> = {};
  for (const [name, profileRaw] of Object.entries(rawProfiles)) {
    const normalized = name.trim();
    if (!normalized || normalized.includes("/") || normalized.includes("..")) {
      throw new Error("futu-stock profile names must not be empty or include path separators");
    }
    profiles[normalized] = parseProfile(profileRaw, normalized);
  }
  if (!Object.keys(profiles).length) throw new Error(`futu-stock config must include at least one profile: ${path}`);
  return { profiles };
}

export function resolveFutuStockProfile(
  config: FutuStockConfig,
  name = "default",
  overrides?: { account_alias?: string; redaction?: FutuRedactionLevel },
): FutuStockProfileConfig {
  const profileName = name.trim() || "default";
  const profile = config.profiles[profileName];
  if (!profile) throw new Error(`unknown futu-stock profile: ${profileName}`);
  return {
    ...profile,
    account_alias: overrides?.account_alias?.trim() || profile.account_alias,
    redaction: overrides?.redaction ?? profile.redaction,
  };
}
