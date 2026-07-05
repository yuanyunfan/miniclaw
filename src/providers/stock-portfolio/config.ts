import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import type {
  StockPortfolioEquityLookthroughAliasConfig,
  StockPortfolioEquityLookthroughColumnConfig,
  StockPortfolioEquityLookthroughConstituentConfig,
  StockPortfolioEquityLookthroughDataSourceConfig,
  StockPortfolioMarketScope,
  StockPortfolioProviderConfig,
  StockPortfolioEquityLookthroughSourceConfig,
  StockPortfolioEquityLookthroughSourceType,
  StockPortfolioSourceConfig,
  StockPortfolioSourceName,
} from "../../stock/data/portfolio-types.js";

const CONFIG_DIR_DEFAULT = join(homedir(), ".miniclaw/providers/stock-portfolio");
const RESERVED_PROVIDER_CONFIG_NAMES = new Set(["config"]);
const SOURCE_NAMES = new Set<StockPortfolioSourceName>(["futu-stock", "eastmoney-jywg-readonly", "eastmoney-etf-premium"]);
const MARKET_SCOPES = new Set<StockPortfolioMarketScope>(["all", "us", "cn"]);
const LOOKTHROUGH_SOURCE_TYPES = new Set<StockPortfolioEquityLookthroughSourceType>([
  "http_json",
  "http_csv",
  "http_xlsx",
  "eastmoney_fund_holdings",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function codeString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`stock-portfolio ${field} must be a YAML array`);
  return value
    .map((item) => codeString(item))
    .filter((item): item is string => item !== undefined);
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function positiveNumberMap(value: unknown): Record<string, number> {
  if (!isPlainObject(value)) return { CNY: 1 };
  const mapped: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const currency = key.trim().toUpperCase();
    if (!currency) continue;
    const number = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : undefined;
    if (number === undefined || !Number.isFinite(number) || number <= 0) {
      throw new Error(`stock-portfolio fx_rates.${currency} must be a positive number`);
    }
    mapped[currency] = number;
  }
  return Object.keys(mapped).length ? { CNY: 1, ...mapped } : { CNY: 1 };
}

function nonNegativeInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return fallback;
  return Math.min(value, max);
}

function positiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return fallback;
  return Math.min(value, max);
}

function positiveNumber(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : undefined;
  if (parsed === undefined || !Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`stock-portfolio ${field} must be a positive number`);
  }
  return parsed;
}

function marketScope(value: unknown): StockPortfolioMarketScope {
  if (value === undefined || value === null || value === "") return "all";
  if (typeof value !== "string" || !MARKET_SCOPES.has(value as StockPortfolioMarketScope)) {
    throw new Error(`stock-portfolio market_scope must be one of: ${[...MARKET_SCOPES].join(", ")}`);
  }
  return value as StockPortfolioMarketScope;
}

function sourceName(value: unknown): StockPortfolioSourceName {
  if (typeof value !== "string" || !SOURCE_NAMES.has(value as StockPortfolioSourceName)) {
    throw new Error(`stock-portfolio source provider must be one of: ${[...SOURCE_NAMES].join(", ")}`);
  }
  return value as StockPortfolioSourceName;
}

function parseSource(raw: unknown): StockPortfolioSourceConfig {
  if (!isPlainObject(raw)) throw new Error("stock-portfolio sources[] must be a YAML object");
  return {
    provider: sourceName(raw.provider),
    config: optionalString(raw.config),
    label: optionalString(raw.label),
    asset_account_label: optionalString(raw.asset_account_label),
    enabled: boolValue(raw.enabled, true),
    required: boolValue(raw.required, false),
    include_asset_totals: boolValue(raw.include_asset_totals, true),
  };
}

function parseLookthroughConstituent(
  raw: unknown,
  sourceLabel: string,
  index: number,
): StockPortfolioEquityLookthroughConstituentConfig {
  if (!isPlainObject(raw)) {
    throw new Error(`stock-portfolio equity_lookthrough_sources[${sourceLabel}].constituents[${index}] must be a YAML object`);
  }
  const company = optionalString(raw.company) ?? optionalString(raw.name);
  const code = codeString(raw.code);
  if (!company) {
    throw new Error(`stock-portfolio equity_lookthrough_sources[${sourceLabel}].constituents[${index}].company is required`);
  }
  if (!code) {
    throw new Error(`stock-portfolio equity_lookthrough_sources[${sourceLabel}].constituents[${index}].code is required`);
  }
  const weightPct = positiveNumber(raw.weight_pct ?? raw.weight, `equity_lookthrough_sources[${sourceLabel}].constituents[${index}].weight_pct`);
  if (weightPct > 100) {
    throw new Error(`stock-portfolio equity_lookthrough_sources[${sourceLabel}].constituents[${index}].weight_pct must be <= 100`);
  }
  return {
    company_key: optionalString(raw.company_key),
    company,
    code,
    aliases: stringArray(raw.aliases, `equity_lookthrough_sources[${sourceLabel}].constituents[${index}].aliases`),
    weight_pct: weightPct,
  };
}

function parseLookthroughAlias(raw: unknown, sourceLabel: string, index: number): StockPortfolioEquityLookthroughAliasConfig {
  if (!isPlainObject(raw)) {
    throw new Error(`stock-portfolio equity_lookthrough_sources[${sourceLabel}].company_aliases[${index}] must be a YAML object`);
  }
  const companyKey = codeString(raw.company_key);
  const company = optionalString(raw.company) ?? optionalString(raw.name);
  const code = codeString(raw.code);
  if (!companyKey) throw new Error(`stock-portfolio equity_lookthrough_sources[${sourceLabel}].company_aliases[${index}].company_key is required`);
  if (!company) throw new Error(`stock-portfolio equity_lookthrough_sources[${sourceLabel}].company_aliases[${index}].company is required`);
  if (!code) throw new Error(`stock-portfolio equity_lookthrough_sources[${sourceLabel}].company_aliases[${index}].code is required`);
  return {
    company_key: companyKey,
    company,
    code,
    aliases: stringArray(raw.aliases, `equity_lookthrough_sources[${sourceLabel}].company_aliases[${index}].aliases`),
  };
}

function columnNames(value: unknown, field: string): string[] {
  if (Array.isArray(value)) {
    const names = value.map((item) => optionalString(item)).filter((item): item is string => item !== undefined);
    if (names.length) return names;
  }
  const single = optionalString(value);
  if (single) return [single];
  throw new Error(`stock-portfolio ${field} is required`);
}

function parseLookthroughColumns(raw: unknown, sourceLabel: string): StockPortfolioEquityLookthroughColumnConfig {
  if (!isPlainObject(raw)) {
    throw new Error(`stock-portfolio equity_lookthrough_sources[${sourceLabel}].data_source.columns must be a YAML object`);
  }
  return {
    company: columnNames(raw.company ?? raw.name, `equity_lookthrough_sources[${sourceLabel}].data_source.columns.company`),
    code: columnNames(raw.code ?? raw.ticker, `equity_lookthrough_sources[${sourceLabel}].data_source.columns.code`),
    weight_pct: columnNames(raw.weight_pct ?? raw.weight, `equity_lookthrough_sources[${sourceLabel}].data_source.columns.weight_pct`),
  };
}

function parseLookthroughDataSource(raw: unknown, sourceLabel: string): StockPortfolioEquityLookthroughDataSourceConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isPlainObject(raw)) throw new Error(`stock-portfolio equity_lookthrough_sources[${sourceLabel}].data_source must be a YAML object`);
  if (typeof raw.type !== "string" || !LOOKTHROUGH_SOURCE_TYPES.has(raw.type as StockPortfolioEquityLookthroughSourceType)) {
    throw new Error(`stock-portfolio equity_lookthrough_sources[${sourceLabel}].data_source.type must be one of: ${[...LOOKTHROUGH_SOURCE_TYPES].join(", ")}`);
  }
  const url = optionalString(raw.url);
  if (!url) throw new Error(`stock-portfolio equity_lookthrough_sources[${sourceLabel}].data_source.url is required`);
  return {
    type: raw.type as StockPortfolioEquityLookthroughSourceType,
    url,
    items_path: optionalString(raw.items_path),
    columns: parseLookthroughColumns(raw.columns, sourceLabel),
    timeout_ms: positiveInt(raw.timeout_ms, 12000, 60000),
    user_agent: optionalString(raw.user_agent),
  };
}

function parseLookthroughSource(raw: unknown, index: number): StockPortfolioEquityLookthroughSourceConfig {
  if (!isPlainObject(raw)) throw new Error("stock-portfolio equity_lookthrough_sources[] must be a YAML object");
  const label = optionalString(raw.label) ?? optionalString(raw.source);
  if (!label) throw new Error(`stock-portfolio equity_lookthrough_sources[${index}].label is required`);
  const matchCodes = stringArray(raw.match_codes ?? raw.codes, `equity_lookthrough_sources[${label}].match_codes`);
  const matchNames = stringArray(raw.match_names ?? raw.names, `equity_lookthrough_sources[${label}].match_names`);
  if (!matchCodes.length && !matchNames.length) {
    throw new Error(`stock-portfolio equity_lookthrough_sources[${label}] requires match_codes or match_names`);
  }
  const dataSource = parseLookthroughDataSource(raw.data_source, label);
  const constituents = Array.isArray(raw.constituents)
    ? raw.constituents.map((item, itemIndex) => parseLookthroughConstituent(item, label, itemIndex))
    : [];
  if (!dataSource && !constituents.length) {
    throw new Error(`stock-portfolio equity_lookthrough_sources[${label}] requires data_source or constituents`);
  }
  return {
    label,
    match_codes: matchCodes,
    match_names: matchNames,
    data_source: dataSource,
    company_aliases: Array.isArray(raw.company_aliases)
      ? raw.company_aliases.map((item, itemIndex) => parseLookthroughAlias(item, label, itemIndex))
      : [],
    constituents,
  };
}

function configDir(): string {
  return process.env.MINICLAW_STOCK_PORTFOLIO_PROVIDER_CONFIG_DIR ?? CONFIG_DIR_DEFAULT;
}

function validateConfigName(name: string): void {
  if (!name || name.includes("/") || name.includes("..")) {
    throw new Error("stock-portfolio provider config name must not be empty or include path separators");
  }
  if (RESERVED_PROVIDER_CONFIG_NAMES.has(name)) {
    throw new Error("stock-portfolio provider config name 'config' is reserved");
  }
}

export function getStockPortfolioProviderConfigPath(name = "default"): string {
  validateConfigName(name);
  return join(configDir(), `${name}.yaml`);
}

export function loadStockPortfolioProviderConfig(name = "default"): StockPortfolioProviderConfig {
  const path = getStockPortfolioProviderConfigPath(name);
  if (!existsSync(path)) throw new Error(`stock-portfolio provider config not found: ${path}`);
  const raw = yamlLoad(readFileSync(path, "utf8")) as unknown;
  if (!isPlainObject(raw)) throw new Error(`stock-portfolio provider config must be a YAML object: ${path}`);
  if (!Array.isArray(raw.sources)) throw new Error("stock-portfolio provider config requires sources[]");
  const sources = raw.sources.map(parseSource).filter((source) => source.enabled);
  if (!sources.length) throw new Error("stock-portfolio provider config requires at least one enabled source");
  return {
    sources,
    continue_on_error: boolValue(raw.continue_on_error, true),
    fail_if_all_sources_fail: boolValue(raw.fail_if_all_sources_fail, true),
    market_scope: marketScope(raw.market_scope),
    base_currency: optionalString(raw.base_currency)?.toUpperCase() ?? "CNY",
    fx_rates: positiveNumberMap(raw.fx_rates),
    fx_rates_as_of: optionalString(raw.fx_rates_as_of),
    fx_rates_source: optionalString(raw.fx_rates_source),
    top_movers_limit: nonNegativeInt(raw.top_movers_limit, 5, 20),
    include_cny_summary: boolValue(raw.include_cny_summary, true),
    include_asset_summary: boolValue(raw.include_asset_summary, false),
    include_asset_pie_chart: boolValue(raw.include_asset_pie_chart, false),
    include_equity_lookthrough_summary: boolValue(raw.include_equity_lookthrough_summary, false),
    include_equity_lookthrough_chart: boolValue(raw.include_equity_lookthrough_chart, boolValue(raw.include_equity_lookthrough_summary, false)),
    equity_lookthrough_top_limit: nonNegativeInt(raw.equity_lookthrough_top_limit, 30, 100),
    equity_lookthrough_sources: Array.isArray(raw.equity_lookthrough_sources)
      ? raw.equity_lookthrough_sources.map(parseLookthroughSource)
      : [],
  };
}
