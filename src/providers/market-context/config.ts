import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import type { MarketContextScope } from "../../store/market-context.js";
import type { MarketContextProviderConfig, MarketContextProviderMode } from "../../stock/data/market-context-types.js";

const CONFIG_DIR_DEFAULT = join(homedir(), ".miniclaw/providers/market-context");
const RESERVED_PROVIDER_CONFIG_NAMES = new Set(["config"]);
const MODES = new Set<MarketContextProviderMode>(["update", "inject"]);
const SCOPES = new Set<MarketContextScope>(["us", "cn-a", "hk", "cross-market"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInt(value: unknown, fallback: number, max: number, field: string): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : fallback;
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`market-context ${field} must be a positive integer`);
  return Math.min(parsed, max);
}

function mode(value: unknown): MarketContextProviderMode {
  if (typeof value !== "string" || !MODES.has(value as MarketContextProviderMode)) {
    throw new Error(`market-context mode must be one of: ${[...MODES].join(", ")}`);
  }
  return value as MarketContextProviderMode;
}

function scope(value: unknown, field: string): MarketContextScope {
  if (typeof value !== "string" || !SCOPES.has(value as MarketContextScope)) {
    throw new Error(`market-context ${field} must be one of: ${[...SCOPES].join(", ")}`);
  }
  return value as MarketContextScope;
}

function scopeArray(value: unknown): MarketContextScope[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("market-context market_scopes must be a non-empty array");
  }
  return value.map((item, index) => scope(item, `market_scopes[${index}]`));
}

function configDir(): string {
  return process.env.MINICLAW_MARKET_CONTEXT_PROVIDER_CONFIG_DIR
    ?? process.env.MINICLAW_MARKET_CONTEXT_CONFIG_DIR
    ?? CONFIG_DIR_DEFAULT;
}

function validateConfigName(name: string): void {
  if (!name || name.includes("/") || name.includes("..")) {
    throw new Error("market-context provider config name must not be empty or include path separators");
  }
  if (RESERVED_PROVIDER_CONFIG_NAMES.has(name)) {
    throw new Error("market-context provider config name 'config' is reserved");
  }
}

export function getMarketContextProviderConfigPath(name = "default"): string {
  validateConfigName(name);
  return join(configDir(), `${name}.yaml`);
}

export function loadMarketContextProviderConfig(name = "default"): MarketContextProviderConfig {
  const path = getMarketContextProviderConfigPath(name);
  if (!existsSync(path)) throw new Error(`market-context provider config not found: ${path}`);
  const raw = yamlLoad(readFileSync(path, "utf8")) as unknown;
  if (!isPlainObject(raw)) throw new Error(`market-context provider config must be a YAML object: ${path}`);
  const parsedMode = mode(raw.mode);
  const marketScope = raw.market_scope === undefined ? undefined : scope(raw.market_scope, "market_scope");
  const marketScopes = raw.market_scopes === undefined
    ? marketScope
      ? [marketScope]
      : []
    : scopeArray(raw.market_scopes);
  if (parsedMode === "update" && !marketScope) {
    throw new Error("market-context update mode requires market_scope");
  }
  if (!marketScopes.length) {
    throw new Error("market-context config requires market_scope or market_scopes");
  }
  return {
    mode: parsedMode,
    timezone: optionalString(raw.timezone)
      ?? (marketScope === "us" || marketScopes.includes("us") ? "America/New_York" : "Asia/Shanghai"),
    market_scope: marketScope,
    market_scopes: marketScopes,
    forecast_market_scope: optionalString(raw.forecast_market_scope),
    forecast_session: optionalString(raw.forecast_session) ?? "pre_market",
    lookback_days: positiveInt(raw.lookback_days, 14, 120, "lookback_days"),
    max_items: positiveInt(raw.max_items, 12, 80, "max_items"),
    max_digest_chars: positiveInt(raw.max_digest_chars, 1800, 12000, "max_digest_chars"),
  };
}
