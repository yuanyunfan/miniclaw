import type { PreProviderResult, PreProviderRunArgs } from "../types.js";
import type {
  MarketIntelPortfolioContext,
  MarketIntelPortfolioRunner,
  MarketIntelPortfolioSourceSummary,
  MarketIntelProviderConfig,
} from "./types.js";
import { sanitizeMarketIntelError } from "./redaction.js";
import type { StockPortfolioAssetSummary, StockPortfolioCnySummary } from "../stock-portfolio/types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map(sanitizeMarketIntelError)
    : [];
}

function sourceSummary(source: unknown): MarketIntelPortfolioSourceSummary | undefined {
  if (!isRecord(source)) return undefined;
  const status = source.status === "ok" ? "ok" : source.status === "error" ? "error" : undefined;
  if (!status) return undefined;
  return {
    provider: str(source.provider, "unknown"),
    config: str(source.config, "default"),
    label: str(source.label) || undefined,
    status,
    error: status === "error" ? sanitizeMarketIntelError(str(source.error, "unknown error")) : undefined,
  };
}

function parseStockPortfolioText(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) throw new Error("payload is not a JSON object");
    if (parsed.source !== "stock-portfolio") throw new Error(`unexpected source: ${str(parsed.source, "unknown")}`);
    return parsed;
  } catch (err) {
    throw new Error(`market-intel portfolio payload parse failed: ${sanitizeMarketIntelError(err)}`);
  }
}

export function buildNotConfiguredPortfolioContext(): MarketIntelPortfolioContext {
  return {
    status: "not_configured",
    ok_count: 0,
    failed_count: 0,
    sources: [],
    warnings: [],
    usage_notes: [],
    notes: ["portfolio_provider_config is not set; portfolio context is not included."],
  };
}

export function buildPortfolioContextFromText(text: string, profile: string): MarketIntelPortfolioContext {
  const payload = parseStockPortfolioText(text);
  const okCount = num(payload.ok_count);
  const failedCount = num(payload.failed_count);
  const warnings = stringList(payload.warnings);
  return {
    status: failedCount > 0 ? "partial" : "ok",
    profile,
    ok_count: okCount,
    failed_count: failedCount,
    cny_summary: isRecord(payload.cny_summary) ? payload.cny_summary as unknown as StockPortfolioCnySummary : undefined,
    asset_summary: isRecord(payload.asset_summary) ? payload.asset_summary as unknown as StockPortfolioAssetSummary : undefined,
    sources: Array.isArray(payload.sources)
      ? payload.sources.map(sourceSummary).filter((source): source is MarketIntelPortfolioSourceSummary => source !== undefined)
      : [],
    warnings,
    usage_notes: stringList(payload.usage_notes),
    notes: [
      "Portfolio context comes from stock-portfolio, which aggregates existing read-only broker providers.",
      "Use cny_summary for reportable P&L values. Do not expose raw nested broker payloads or account identifiers.",
    ],
  };
}

export async function collectMarketIntelPortfolio(params: {
  args: PreProviderRunArgs;
  config: MarketIntelProviderConfig;
  runner: MarketIntelPortfolioRunner;
}): Promise<{ context: MarketIntelPortfolioContext; commit?: PreProviderResult["commit"] }> {
  if (!params.config.portfolio_provider_config) {
    return { context: buildNotConfiguredPortfolioContext() };
  }
  try {
    const result = await params.runner({
      ...params.args,
      configName: params.config.portfolio_provider_config,
    });
    return {
      context: buildPortfolioContextFromText(result.text, params.config.portfolio_provider_config),
      commit: result.commit,
    };
  } catch (err) {
    throw new Error(`market-intel portfolio source failed: ${sanitizeMarketIntelError(err)}`);
  }
}
