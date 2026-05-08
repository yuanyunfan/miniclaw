import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import type { EastmoneyJywgRedactionLevel } from "../../mcp/eastmoney-jywg/types.js";
import { resolveHome } from "../../mcp/eastmoney-jywg/session-vault.js";
import type { EastmoneyJywgProviderConfig } from "./types.js";

const CONFIG_DIR_DEFAULT = join(homedir(), ".miniclaw/providers/eastmoney-jywg-readonly");
const RESERVED_PROVIDER_CONFIG_NAMES = new Set(["config"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function stringMap(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {};
  const mapped: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    const normalizedValue = optionalString(raw);
    if (normalizedValue) mapped[normalizedKey] = normalizedValue;
  }
  return mapped;
}

function configDir(): string {
  return process.env.MINICLAW_EASTMONEY_JYWG_PROVIDER_CONFIG_DIR ?? CONFIG_DIR_DEFAULT;
}

function validateConfigName(name: string): void {
  if (!name || name.includes("/") || name.includes("..")) {
    throw new Error("eastmoney-jywg provider config name must not be empty or include path separators");
  }
  if (RESERVED_PROVIDER_CONFIG_NAMES.has(name)) {
    throw new Error("eastmoney-jywg provider config name 'config' is reserved for the profile config");
  }
}

export function getEastmoneyJywgProviderConfigPath(name = "default"): string {
  validateConfigName(name);
  return resolveHome(join(configDir(), `${name}.yaml`));
}

export function loadEastmoneyJywgProviderConfig(name = "default"): EastmoneyJywgProviderConfig {
  const path = getEastmoneyJywgProviderConfigPath(name);
  if (!existsSync(path)) throw new Error(`eastmoney-jywg provider config not found: ${path}`);
  const raw = yamlLoad(readFileSync(path, "utf8")) as unknown;
  if (!isPlainObject(raw)) throw new Error(`eastmoney-jywg provider config must be a YAML object: ${path}`);
  return {
    profile: stringValue(raw.profile, "default"),
    account_alias: optionalString(raw.account_alias),
    market_session: optionalString(raw.market_session),
    market_session_by_job: stringMap(raw.market_session_by_job),
    redaction: redactionValue(raw.redaction, "summary"),
    top_positions_limit: nonNegativeInt(raw.top_positions_limit, 8, 20),
    include_account_snapshot: boolValue(raw.include_account_snapshot, true),
    include_daily_report: boolValue(raw.include_daily_report, true),
    include_positions_summary: boolValue(raw.include_positions_summary, true),
  };
}

export function resolveEastmoneyJywgProviderMarketSession(config: EastmoneyJywgProviderConfig, jobName: string): string {
  return config.market_session_by_job[jobName] ?? config.market_session ?? jobName;
}
