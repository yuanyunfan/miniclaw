import type { PreProviderRunArgs } from "../../types.js";
import { sanitizeMarketIntelError } from "../redaction.js";
import type {
  MarketIntelDataQualitySource,
  MarketIntelEvidenceItem,
  MarketIntelEvidenceSection,
  MarketIntelProviderConfig,
  MarketIntelSourceStatus,
  MarketIntelSourceTier,
} from "../types.js";

export interface MarketIntelOfficialHttpClient {
  getText(url: string, init?: { headers?: Record<string, string> }): Promise<string>;
  getJson(url: string, init?: { headers?: Record<string, string> }): Promise<unknown>;
  postJson(url: string, body: unknown, init?: { headers?: Record<string, string> }): Promise<unknown>;
}

export interface OfficialCollectorParams {
  args: PreProviderRunArgs;
  config: MarketIntelProviderConfig;
  http: MarketIntelOfficialHttpClient;
}

export interface CollectorResult {
  items: MarketIntelEvidenceItem[];
  source: MarketIntelDataQualitySource;
  warnings?: string[];
}

export function source(params: {
  id: string;
  collector: string;
  source: string;
  tier: MarketIntelSourceTier;
  status: MarketIntelSourceStatus;
  message?: string;
}): MarketIntelDataQualitySource {
  return params;
}

export function section(
  items: MarketIntelEvidenceItem[],
  sources: MarketIntelDataQualitySource[],
  notes: string[],
): MarketIntelEvidenceSection {
  const failures = sources.filter((item) => item.status === "failed" || item.status === "missing_config");
  const implemented = sources.filter((item) => item.status !== "skipped");
  const status = items.length
    ? failures.length ? "partial" : "ok"
    : implemented.length
      ? failures.length ? "partial" : "empty"
      : sources.length ? "skipped" : "empty";
  return { status, items, notes };
}

export function emptySection(status: MarketIntelEvidenceSection["status"], note: string): MarketIntelEvidenceSection {
  return { status, items: [], notes: [note] };
}

export function dedupeEvidence(items: MarketIntelEvidenceItem[]): MarketIntelEvidenceItem[] {
  const seen = new Set<string>();
  const out: MarketIntelEvidenceItem[] = [];
  for (const item of items) {
    const key = item.url ? `${item.id}:${item.url}` : item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function failureResult(params: {
  id: string;
  collector: string;
  sourceName: string;
  tier?: MarketIntelSourceTier;
  err: unknown;
}): CollectorResult {
  const message = sanitizeMarketIntelError(params.err);
  return {
    items: [],
    source: source({
      id: params.id,
      collector: params.collector,
      source: params.sourceName,
      tier: params.tier ?? "official",
      status: "failed",
      message,
    }),
    warnings: [`${params.collector}: ${params.sourceName} failed: ${message}`],
  };
}

export function skippedResult(params: {
  id: string;
  collector: string;
  sourceName: string;
  tier?: MarketIntelSourceTier;
  message: string;
}): CollectorResult {
  return {
    items: [],
    source: source({
      id: params.id,
      collector: params.collector,
      source: params.sourceName,
      tier: params.tier ?? "official",
      status: "skipped",
      message: params.message,
    }),
  };
}
