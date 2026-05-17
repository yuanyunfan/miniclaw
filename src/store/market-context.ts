import { createHash } from "node:crypto";
import { v4 as uuid } from "uuid";
import { getDb } from "./connection.js";

export type MarketContextScope = "us" | "cn-a" | "hk" | "cross-market";
export type MarketContextItemStatus = "active" | "stale" | "resolved";

export interface MarketContextDailyRow {
  id: string;
  task_id: string | null;
  job_name: string | null;
  channel_id: string | null;
  market_scope: MarketContextScope;
  trade_date: string;
  generated_at: string;
  previous_context_id: string | null;
  digest_text: string;
  active_items_json: string;
  new_items_json: string;
  resolved_items_json: string;
  data_quality_json: string;
  source_payload_json: string | null;
  report_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarketContextItemRow {
  id: string;
  market_scope: MarketContextScope;
  stable_key: string;
  topic: string;
  fact: string;
  market_impact: string;
  affected_markets_json: string;
  horizon: string;
  status: MarketContextItemStatus;
  confidence: number | null;
  source_urls_json: string;
  evidence_ids_json: string;
  first_seen_at: string;
  last_updated_at: string;
  expires_at: string | null;
  source_daily_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarketContextReportItem {
  stable_key?: string;
  topic: string;
  fact: string;
  market_impact: string;
  affected_markets?: string[];
  horizon?: string;
  status?: MarketContextItemStatus;
  confidence?: number;
  source_urls?: string[];
  evidence_ids?: string[];
  expires_at?: string;
}

export interface MarketContextReportJson {
  market_scope?: MarketContextScope;
  trade_date?: string;
  digest_text?: string;
  summary?: string;
  active_items?: MarketContextReportItem[];
  new_items?: MarketContextReportItem[];
  resolved_items?: MarketContextReportItem[];
  data_quality?: unknown;
}

export interface MarketContextUpdateResult {
  hasJson: boolean;
  dailyId?: string;
  upsertedItemCount: number;
}

const MARKET_CONTEXT_SCOPES = new Set<MarketContextScope>(["us", "cn-a", "hk", "cross-market"]);
const ITEM_STATUSES = new Set<MarketContextItemStatus>(["active", "stale", "resolved"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function clampConfidence(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function parseScope(value: unknown, fallback: MarketContextScope): MarketContextScope {
  return typeof value === "string" && MARKET_CONTEXT_SCOPES.has(value as MarketContextScope)
    ? value as MarketContextScope
    : fallback;
}

function parseStatus(value: unknown): MarketContextItemStatus {
  return typeof value === "string" && ITEM_STATUSES.has(value as MarketContextItemStatus)
    ? value as MarketContextItemStatus
    : "active";
}

function normalizeKey(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function stableKeyFor(item: MarketContextReportItem): string {
  const explicit = optionalString(item.stable_key);
  if (explicit) return normalizeKey(explicit) || explicit.slice(0, 80);
  const normalized = normalizeKey(`${item.topic} ${item.horizon ?? ""}`);
  if (normalized) return normalized;
  return createHash("sha256").update(`${item.topic}\n${item.fact}`, "utf8").digest("hex").slice(0, 16);
}

function sanitizeItem(raw: unknown, fallbackStatus: MarketContextItemStatus): MarketContextReportItem | undefined {
  const obj = asRecord(raw);
  if (!obj) return undefined;
  const topic = optionalString(obj.topic);
  const fact = optionalString(obj.fact);
  const marketImpact = optionalString(obj.market_impact) ?? optionalString(obj.impact);
  if (!topic || !fact || !marketImpact) return undefined;
  return {
    stable_key: optionalString(obj.stable_key),
    topic,
    fact,
    market_impact: marketImpact,
    affected_markets: stringArray(obj.affected_markets),
    horizon: optionalString(obj.horizon) ?? "1w",
    status: obj.status === undefined ? fallbackStatus : parseStatus(obj.status),
    confidence: clampConfidence(obj.confidence),
    source_urls: stringArray(obj.source_urls),
    evidence_ids: stringArray(obj.evidence_ids),
    expires_at: optionalString(obj.expires_at),
  };
}

function sanitizeItems(value: unknown, fallbackStatus: MarketContextItemStatus): MarketContextReportItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => sanitizeItem(item, fallbackStatus)).filter((item): item is MarketContextReportItem => item !== undefined);
}

function parseMarketContextJsonCandidate(candidate: string): MarketContextReportJson | undefined {
  try {
    const parsed = JSON.parse(candidate);
    const obj = asRecord(parsed);
    if (!obj) return undefined;
    if (!("digest_text" in obj) && !("summary" in obj) && !("active_items" in obj)) return undefined;
    return {
      market_scope: typeof obj.market_scope === "string" && MARKET_CONTEXT_SCOPES.has(obj.market_scope as MarketContextScope)
        ? obj.market_scope as MarketContextScope
        : undefined,
      trade_date: optionalString(obj.trade_date),
      digest_text: optionalString(obj.digest_text),
      summary: optionalString(obj.summary),
      active_items: sanitizeItems(obj.active_items, "active"),
      new_items: sanitizeItems(obj.new_items, "active"),
      resolved_items: sanitizeItems(obj.resolved_items, "resolved"),
      data_quality: obj.data_quality,
    };
  } catch {
    return undefined;
  }
}

export function extractMarketContextJsonFromReport(reportText: string): MarketContextReportJson | undefined {
  const tagged = reportText.match(/<market_context_json>\s*([\s\S]*?)\s*<\/market_context_json>/i);
  if (tagged?.[1]) {
    const parsed = parseMarketContextJsonCandidate(tagged[1]);
    if (parsed) return parsed;
  }

  const fencePattern = /```(?:market-context-json|market_context_json|json)\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(reportText)) !== null) {
    if (!match[1]) continue;
    const parsed = parseMarketContextJsonCandidate(match[1]);
    if (parsed) return parsed;
  }
  return undefined;
}

export function stripMarketContextJsonForDisplay(reportText: string): string {
  return reportText
    .replace(/<market_context_json>\s*[\s\S]*?\s*<\/market_context_json>/gi, "")
    .replace(/```(?:market-context-json|market_context_json)\s*[\s\S]*?```/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function getLatestMarketContextDaily(scope: MarketContextScope): MarketContextDailyRow | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM market_context_daily
       WHERE market_scope = ?
       ORDER BY generated_at DESC, trade_date DESC, created_at DESC
       LIMIT 1`
    )
    .get(scope) as MarketContextDailyRow | undefined;
}

export function listRecentMarketContextDaily(scope: MarketContextScope, limit = 5): MarketContextDailyRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM market_context_daily
       WHERE market_scope = @scope
       ORDER BY generated_at DESC, trade_date DESC, created_at DESC
       LIMIT @limit`
    )
    .all({ scope, limit: Math.max(1, Math.min(30, limit)) }) as MarketContextDailyRow[];
}

export function findMarketContextDaily(scope: MarketContextScope, tradeDate: string): MarketContextDailyRow | undefined {
  return getDb()
    .prepare("SELECT * FROM market_context_daily WHERE market_scope = ? AND trade_date = ? LIMIT 1")
    .get(scope, tradeDate) as MarketContextDailyRow | undefined;
}

export function listActiveMarketContextItems(
  scopes: MarketContextScope[],
  nowIso = new Date().toISOString(),
  limit = 40,
): MarketContextItemRow[] {
  const unique = [...new Set(scopes)].filter((scope) => MARKET_CONTEXT_SCOPES.has(scope));
  if (!unique.length) return [];
  const placeholders = unique.map((_, index) => `@scope${index}`).join(", ");
  const params: Record<string, unknown> = {
    now: nowIso,
    limit: Math.max(1, Math.min(200, limit)),
  };
  unique.forEach((scope, index) => { params[`scope${index}`] = scope; });
  return getDb()
    .prepare(
      `SELECT * FROM market_context_items
       WHERE market_scope IN (${placeholders})
         AND status = 'active'
         AND (expires_at IS NULL OR expires_at > @now)
       ORDER BY last_updated_at DESC, created_at DESC
       LIMIT @limit`
    )
    .all(params) as MarketContextItemRow[];
}

function upsertDaily(input: {
  id: string;
  taskId?: string;
  jobName?: string;
  channelId?: string;
  marketScope: MarketContextScope;
  tradeDate: string;
  generatedAt: string;
  previousContextId?: string;
  digestText: string;
  activeItems: MarketContextReportItem[];
  newItems: MarketContextReportItem[];
  resolvedItems: MarketContextReportItem[];
  dataQuality: unknown;
  sourcePayload?: unknown;
  reportText: string;
}): void {
  getDb().prepare(
    `INSERT INTO market_context_daily (
      id, task_id, job_name, channel_id, market_scope, trade_date, generated_at,
      previous_context_id, digest_text, active_items_json, new_items_json,
      resolved_items_json, data_quality_json, source_payload_json, report_text
    ) VALUES (
      @id, @task_id, @job_name, @channel_id, @market_scope, @trade_date, @generated_at,
      @previous_context_id, @digest_text, @active_items_json, @new_items_json,
      @resolved_items_json, @data_quality_json, @source_payload_json, @report_text
    )
    ON CONFLICT(market_scope, trade_date) DO UPDATE SET
      task_id = excluded.task_id,
      job_name = excluded.job_name,
      channel_id = excluded.channel_id,
      generated_at = excluded.generated_at,
      previous_context_id = excluded.previous_context_id,
      digest_text = excluded.digest_text,
      active_items_json = excluded.active_items_json,
      new_items_json = excluded.new_items_json,
      resolved_items_json = excluded.resolved_items_json,
      data_quality_json = excluded.data_quality_json,
      source_payload_json = excluded.source_payload_json,
      report_text = excluded.report_text,
      updated_at = datetime('now')`
  ).run({
    id: input.id,
    task_id: input.taskId ?? null,
    job_name: input.jobName ?? null,
    channel_id: input.channelId ?? null,
    market_scope: input.marketScope,
    trade_date: input.tradeDate,
    generated_at: input.generatedAt,
    previous_context_id: input.previousContextId ?? null,
    digest_text: input.digestText,
    active_items_json: JSON.stringify(input.activeItems),
    new_items_json: JSON.stringify(input.newItems),
    resolved_items_json: JSON.stringify(input.resolvedItems),
    data_quality_json: JSON.stringify(input.dataQuality ?? {}),
    source_payload_json: input.sourcePayload === undefined ? null : JSON.stringify(input.sourcePayload),
    report_text: input.reportText,
  });
}

function upsertItem(input: {
  item: MarketContextReportItem;
  marketScope: MarketContextScope;
  dailyId: string;
  generatedAt: string;
}): void {
  const stableKey = stableKeyFor(input.item);
  getDb().prepare(
    `INSERT INTO market_context_items (
      id, market_scope, stable_key, topic, fact, market_impact,
      affected_markets_json, horizon, status, confidence, source_urls_json,
      evidence_ids_json, first_seen_at, last_updated_at, expires_at, source_daily_id
    ) VALUES (
      @id, @market_scope, @stable_key, @topic, @fact, @market_impact,
      @affected_markets_json, @horizon, @status, @confidence, @source_urls_json,
      @evidence_ids_json, @first_seen_at, @last_updated_at, @expires_at, @source_daily_id
    )
    ON CONFLICT(market_scope, stable_key) DO UPDATE SET
      topic = excluded.topic,
      fact = excluded.fact,
      market_impact = excluded.market_impact,
      affected_markets_json = excluded.affected_markets_json,
      horizon = excluded.horizon,
      status = excluded.status,
      confidence = excluded.confidence,
      source_urls_json = excluded.source_urls_json,
      evidence_ids_json = excluded.evidence_ids_json,
      last_updated_at = excluded.last_updated_at,
      expires_at = excluded.expires_at,
      source_daily_id = excluded.source_daily_id,
      updated_at = datetime('now')`
  ).run({
    id: uuid(),
    market_scope: input.marketScope,
    stable_key: stableKey,
    topic: input.item.topic,
    fact: input.item.fact,
    market_impact: input.item.market_impact,
    affected_markets_json: JSON.stringify(input.item.affected_markets ?? []),
    horizon: input.item.horizon ?? "1w",
    status: input.item.status ?? "active",
    confidence: input.item.confidence ?? null,
    source_urls_json: JSON.stringify(input.item.source_urls ?? []),
    evidence_ids_json: JSON.stringify(input.item.evidence_ids ?? []),
    first_seen_at: input.generatedAt,
    last_updated_at: input.generatedAt,
    expires_at: input.item.expires_at ?? null,
    source_daily_id: input.dailyId,
  });
}

export function recordMarketContextFromReport(input: {
  taskId?: string;
  jobName?: string;
  channelId?: string;
  marketScope: MarketContextScope;
  generatedAt: string;
  tradeDate?: string;
  sourcePayload?: unknown;
  reportText: string;
}): MarketContextUpdateResult {
  const reportJson = extractMarketContextJsonFromReport(input.reportText);
  if (!reportJson) return { hasJson: false, upsertedItemCount: 0 };

  const marketScope = parseScope(reportJson.market_scope, input.marketScope);
  const tradeDate = reportJson.trade_date ?? input.tradeDate ?? input.generatedAt.slice(0, 10);
  const previous = getLatestMarketContextDaily(marketScope);
  const digestText = reportJson.digest_text ?? reportJson.summary ?? "";
  if (!digestText.trim()) return { hasJson: false, upsertedItemCount: 0 };
  const activeItems = reportJson.active_items ?? [];
  const newItems = reportJson.new_items ?? [];
  const resolvedItems = reportJson.resolved_items ?? [];
  const allItems = [...activeItems, ...newItems, ...resolvedItems];
  const existingDaily = findMarketContextDaily(marketScope, tradeDate);
  const dailyId = existingDaily?.id ?? uuid();

  getDb().transaction(() => {
    upsertDaily({
      id: dailyId,
      taskId: input.taskId,
      jobName: input.jobName,
      channelId: input.channelId,
      marketScope,
      tradeDate,
      generatedAt: input.generatedAt,
      previousContextId: previous && previous.id !== dailyId ? previous.id : undefined,
      digestText,
      activeItems,
      newItems,
      resolvedItems,
      dataQuality: reportJson.data_quality ?? {},
      sourcePayload: input.sourcePayload,
      reportText: input.reportText,
    });
    for (const item of allItems) {
      upsertItem({ item, marketScope, dailyId, generatedAt: input.generatedAt });
    }
  })();

  return { hasJson: true, dailyId, upsertedItemCount: allItems.length };
}
