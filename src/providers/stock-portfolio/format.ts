import type { StockPortfolioPayload, StockPortfolioSourceResult } from "./types.js";

export function sanitizeStockPortfolioError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/(validatekey=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/(password|token|cookie|secret|session|account|customer|acc_id)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
    .replace(/([A-Za-z0-9+/=_-]{24,})/g, "[redacted]")
    .slice(0, 800);
}

function redactJsonStringValues(value: unknown): unknown {
  if (typeof value === "string") return sanitizeStockPortfolioError(value);
  if (Array.isArray(value)) return value.map(redactJsonStringValues);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactJsonStringValues(item)]),
  );
}

export function buildStockPortfolioPayload(params: {
  generatedAt: Date;
  profile: string;
  sources: StockPortfolioSourceResult[];
}): StockPortfolioPayload {
  const failed = params.sources.filter((source) => source.status === "error");
  return {
    generated_at: params.generatedAt.toISOString(),
    source: "stock-portfolio",
    profile: params.profile,
    ok_count: params.sources.length - failed.length,
    failed_count: failed.length,
    sources: params.sources,
    warnings: failed.map((source) => `${source.provider}/${source.config}: ${source.error}`),
    usage_notes: [
      "This payload aggregates read-only broker providers for MiniClaw stock reports.",
      "Each nested provider payload is already redacted; do not output account ids, exact total assets, cookies, validate keys, passwords, or trade passwords.",
      "If one broker source failed, use the remaining source data and explicitly mention the missing source without inventing holdings or P&L.",
    ],
  };
}

export function formatStockPortfolioPayload(payload: StockPortfolioPayload): string {
  return JSON.stringify(redactJsonStringValues(payload), null, 2);
}
