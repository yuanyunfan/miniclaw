import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import type { EastmoneyEtfPremiumProviderConfig, EastmoneyEtfPremiumSymbolConfig } from "../../stock/data/etf-premium-types.js";

const CONFIG_DIR_DEFAULT = join(homedir(), ".miniclaw/providers/eastmoney-etf-premium");
const RESERVED_PROVIDER_CONFIG_NAMES = new Set(["config"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInt(value: unknown, fallback: number, max: number, name: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`eastmoney-etf-premium ${name} must be a positive integer`);
  return Math.min(parsed, max);
}

function normalizeSymbol(raw: unknown): EastmoneyEtfPremiumSymbolConfig {
  const code = typeof raw === "string" ? raw : isPlainObject(raw) ? raw.code : undefined;
  if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) {
    throw new Error("eastmoney-etf-premium symbols[] code must be a 6-digit security code");
  }
  const name = isPlainObject(raw) ? optionalString(raw.name) : undefined;
  return {
    code: code.trim(),
    name,
  };
}

function configDir(): string {
  return process.env.MINICLAW_EASTMONEY_ETF_PREMIUM_CONFIG_DIR ?? CONFIG_DIR_DEFAULT;
}

function validateConfigName(name: string): void {
  if (!name || name.includes("/") || name.includes("..")) {
    throw new Error("eastmoney-etf-premium provider config name must not be empty or include path separators");
  }
  if (RESERVED_PROVIDER_CONFIG_NAMES.has(name)) {
    throw new Error("eastmoney-etf-premium provider config name 'config' is reserved");
  }
}

export function getEastmoneyEtfPremiumProviderConfigPath(name = "default"): string {
  validateConfigName(name);
  return join(configDir(), `${name}.yaml`);
}

export function loadEastmoneyEtfPremiumProviderConfig(name = "default"): EastmoneyEtfPremiumProviderConfig {
  const path = getEastmoneyEtfPremiumProviderConfigPath(name);
  if (!existsSync(path)) throw new Error(`eastmoney-etf-premium provider config not found: ${path}`);
  const raw = yamlLoad(readFileSync(path, "utf8")) as unknown;
  if (!isPlainObject(raw)) throw new Error(`eastmoney-etf-premium provider config must be a YAML object: ${path}`);
  if (!Array.isArray(raw.symbols)) throw new Error("eastmoney-etf-premium provider config requires symbols[]");
  const symbols = raw.symbols.map(normalizeSymbol);
  if (!symbols.length) throw new Error("eastmoney-etf-premium provider config requires at least one symbol");
  return {
    symbols,
    timeout_ms: positiveInt(raw.timeout_ms, 8000, 60000, "timeout_ms"),
    concurrency: positiveInt(raw.concurrency, 3, 8, "concurrency"),
  };
}
