import { v4 as uuid } from "uuid";
import { getDb } from "./connection.js";
import type { MarketIntelPayload, MarketIntelScore } from "../stock/data/market-intel-types.js";

export interface MarketForecastRow {
  id: string;
  task_id: string | null;
  job_name: string | null;
  channel_id: string | null;
  market_scope: string;
  trade_date: string;
  session: string;
  generated_at: string;
  calendar_status: string;
  data_quality_status: string | null;
  payload_json: string;
  report_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarketForecastItemRow {
  id: string;
  forecast_id: string;
  item_type: string;
  target: string;
  direction: string;
  probability: number | null;
  confidence: number | null;
  evidence_ids_json: string;
  invalidation: string | null;
  rationale: string | null;
  source: string;
  created_at: string;
}

export interface MarketForecastEvaluationRow {
  id: string;
  forecast_id: string;
  evaluated_at: string;
  outcome_json: string;
  score_json: string;
  notes: string | null;
  created_at: string;
}

export interface MarketForecastCalibrationRecord {
  forecast: MarketForecastRow;
  items: MarketForecastItemRow[];
  evaluations: MarketForecastEvaluationRow[];
}

export interface ReportForecastExtractionResult {
  hasJson: boolean;
  insertedItemCount: number;
}

interface ForecastJsonObject {
  index_probabilities?: unknown;
  horizon_probabilities?: unknown;
  sector_opportunities?: unknown;
  horizon_sector_opportunities?: unknown;
  risk_alerts?: unknown;
  horizon_risk_alerts?: unknown;
  risks?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value > 1 && value <= 100) return Math.round((value / 100) * 10000) / 10000;
  return value;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function stringifyEvidenceIds(evidenceIds?: string[]): string {
  return JSON.stringify(evidenceIds ?? []);
}

function insertForecastItem(row: {
  forecast_id: string;
  item_type: string;
  target: string;
  direction: string;
  probability?: number;
  confidence?: number;
  evidence_ids?: string[];
  invalidation?: string;
  rationale?: string;
  source: string;
}): string {
  const id = uuid();
  getDb().prepare(
    `INSERT INTO market_forecast_items (
      id, forecast_id, item_type, target, direction, probability, confidence,
      evidence_ids_json, invalidation, rationale, source
    ) VALUES (
      @id, @forecast_id, @item_type, @target, @direction, @probability, @confidence,
      @evidence_ids_json, @invalidation, @rationale, @source
    )`
  ).run({
    id,
    forecast_id: row.forecast_id,
    item_type: row.item_type,
    target: row.target,
    direction: row.direction,
    probability: row.probability ?? null,
    confidence: row.confidence ?? null,
    evidence_ids_json: stringifyEvidenceIds(row.evidence_ids),
    invalidation: row.invalidation ?? null,
    rationale: row.rationale ?? null,
    source: row.source,
  });
  return id;
}

function insertProviderScore(forecastId: string, itemType: string, score: MarketIntelScore): void {
  insertForecastItem({
    forecast_id: forecastId,
    item_type: itemType,
    target: score.target,
    direction: score.direction,
    probability: score.probability,
    confidence: score.confidence,
    evidence_ids: score.evidence_ids,
    invalidation: score.invalidation,
    rationale: score.rationale,
    source: "provider_score",
  });
}

function insertProviderScores(forecastId: string, payload: MarketIntelPayload): void {
  insertProviderScore(forecastId, "index_direction", payload.scores.index_direction);
  for (const score of payload.scores.sector_opportunities) {
    insertProviderScore(forecastId, "sector_opportunity", score);
  }
  insertProviderScore(forecastId, "risk_level", payload.scores.risk_level);
}

export function recordMarketForecastFromPayload(input: {
  id?: string;
  taskId?: string;
  payload: MarketIntelPayload;
}): string {
  const id = input.id ?? uuid();
  const payload = input.payload;
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO market_forecasts (
        id, task_id, job_name, channel_id, market_scope, trade_date, session,
        generated_at, calendar_status, data_quality_status, payload_json
      ) VALUES (
        @id, @task_id, @job_name, @channel_id, @market_scope, @trade_date, @session,
        @generated_at, @calendar_status, @data_quality_status, @payload_json
      )`
    ).run({
      id,
      task_id: input.taskId ?? null,
      job_name: payload.run_context.job_name,
      channel_id: payload.run_context.channel_id,
      market_scope: payload.market_scope,
      trade_date: payload.run_context.trade_date,
      session: payload.session,
      generated_at: payload.generated_at,
      calendar_status: payload.run_context.calendar_status,
      data_quality_status: payload.data_quality.status,
      payload_json: JSON.stringify(payload),
    });
    insertProviderScores(id, payload);
  })();
  return id;
}

function parseForecastJsonCandidate(candidate: string): ForecastJsonObject | undefined {
  try {
    const parsed = JSON.parse(candidate);
    const obj = asRecord(parsed);
    if (!obj) return undefined;
    if (
      !("index_probabilities" in obj)
      && !("horizon_probabilities" in obj)
      && !("sector_opportunities" in obj)
      && !("horizon_sector_opportunities" in obj)
      && !("risk_alerts" in obj)
      && !("horizon_risk_alerts" in obj)
      && !("risks" in obj)
    ) {
      return undefined;
    }
    return obj as ForecastJsonObject;
  } catch {
    return undefined;
  }
}

export function extractMarketForecastJsonFromReport(reportText: string): ForecastJsonObject | undefined {
  const tagged = reportText.match(/<market_forecast_json>\s*([\s\S]*?)\s*<\/market_forecast_json>/i);
  if (tagged?.[1]) {
    const parsed = parseForecastJsonCandidate(tagged[1]);
    if (parsed) return parsed;
  }

  const fencePattern = /```(?:market-forecast-json|forecast_json|json)\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(reportText)) !== null) {
    if (!match[1]) continue;
    const parsed = parseForecastJsonCandidate(match[1]);
    if (parsed) return parsed;
  }
  return undefined;
}

export function stripMarketForecastJsonForDisplay(reportText: string): string {
  const forecastJsonHeading = "(?:Forecast JSON|预测\\s*JSON|预测\\s*json|机器可读\\s*JSON)";
  const taggedBlock = new RegExp(`(?:^|\\n)[ \\t]*(?:#{1,6}[ \\t]+)?${forecastJsonHeading}[ \\t]*\\n+(?:[ \\t]*\\n)*<market_forecast_json>\\s*[\\s\\S]*?\\s*<\\/market_forecast_json>[ \\t]*(?=\\n|$)`, "gi");
  const taggedOnly = /<market_forecast_json>\s*[\s\S]*?\s*<\/market_forecast_json>/gi;
  const fencedBlock = new RegExp(`(?:^|\\n)[ \\t]*(?:#{1,6}[ \\t]+)?${forecastJsonHeading}[ \\t]*\\n+(?:[ \\t]*\\n)*\`\`\`(?:market-forecast-json|forecast_json|json)\\s*[\\s\\S]*?\`\`\`[ \\t]*(?=\\n|$)`, "gi");
  const fencedOnly = /```(?:market-forecast-json|forecast_json)\s*[\s\S]*?```/gi;
  const orphanHeading = new RegExp(`(?:^|\\n)[ \\t]*(?:#{1,6}[ \\t]+)?${forecastJsonHeading}[ \\t]*(?=\\n|$)`, "gi");

  return reportText
    .replace(taggedBlock, "\n")
    .replace(taggedOnly, "")
    .replace(fencedBlock, "\n")
    .replace(fencedOnly, "")
    .replace(orphanHeading, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function probabilityValue(row: Record<string, unknown>, direction: "up" | "range_bound" | "down"): number | undefined {
  if (direction === "range_bound") {
    return optionalNumber(row.range_bound ?? row.range ?? row.range_probability ?? row.range_bound_probability);
  }
  return optionalNumber(row[direction] ?? row[`${direction}_probability`]);
}

function horizonLabel(row: Record<string, unknown>): string | undefined {
  return optionalString(row.horizon) ?? optionalString(row.time_horizon) ?? optionalString(row.period);
}

function withHorizonTarget(target: string, horizon?: string): string {
  if (!horizon) return target;
  return target.includes(horizon) ? target : `${horizon} | ${target}`;
}

function horizonRationale(row: Record<string, unknown>, horizon?: string): string | undefined {
  const parts = [
    horizon ? `horizon=${horizon}` : undefined,
    optionalString(row.rationale) ?? optionalString(row.reason),
    optionalString(row.base_case) ? `base_case=${optionalString(row.base_case)}` : undefined,
    optionalString(row.trigger) ? `trigger=${optionalString(row.trigger)}` : undefined,
    optionalString(row.review_trigger) ? `review_trigger=${optionalString(row.review_trigger)}` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join("; ") : undefined;
}

function insertProbabilityItems(forecastId: string, value: unknown, itemType: "index_probability" | "horizon_probability"): number {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  let count = 0;
  for (const item of rows) {
    const row = asRecord(item);
    if (!row) continue;
    const target = optionalString(row.target) ?? optionalString(row.index) ?? "broad market";
    const horizon = itemType === "horizon_probability" ? horizonLabel(row) : undefined;
    const confidence = optionalNumber(row.confidence);
    const evidenceIds = stringArray(row.evidence_ids);
    const invalidation = optionalString(row.invalidation) ?? optionalString(row.invalidation_trigger);
    const rationale = itemType === "horizon_probability"
      ? horizonRationale(row, horizon)
      : optionalString(row.rationale) ?? optionalString(row.reason);
    for (const direction of ["up", "range_bound", "down"] as const) {
      const probability = probabilityValue(row, direction);
      if (probability === undefined) continue;
      insertForecastItem({
        forecast_id: forecastId,
        item_type: itemType,
        target: withHorizonTarget(target, horizon),
        direction,
        probability,
        confidence,
        evidence_ids: evidenceIds,
        invalidation,
        rationale,
        source: "llm_report",
      });
      count++;
    }
  }
  return count;
}

function insertReportListItems(
  forecastId: string,
  value: unknown,
  itemType: "sector_opportunity" | "risk_alert" | "horizon_sector_opportunity" | "horizon_risk_alert",
): number {
  if (!Array.isArray(value)) return 0;
  let count = 0;
  for (const item of value) {
    const row = asRecord(item);
    if (!row) continue;
    const horizon = itemType.startsWith("horizon_") ? horizonLabel(row) : undefined;
    const target = optionalString(row.target)
      ?? optionalString(row.theme)
      ?? optionalString(row.sector)
      ?? optionalString(row.risk);
    if (!target) continue;
    insertForecastItem({
      forecast_id: forecastId,
      item_type: itemType,
      target: withHorizonTarget(target, horizon),
      direction: optionalString(row.direction) ?? optionalString(row.severity) ?? (itemType.endsWith("risk_alert") ? "risk" : "watchlist"),
      probability: optionalNumber(row.probability),
      confidence: optionalNumber(row.confidence),
      evidence_ids: stringArray(row.evidence_ids),
      invalidation: optionalString(row.invalidation) ?? optionalString(row.invalidation_trigger),
      rationale: itemType.startsWith("horizon_")
        ? horizonRationale(row, horizon)
        : optionalString(row.rationale) ?? optionalString(row.reason) ?? optionalString(row.trigger),
      source: "llm_report",
    });
    count++;
  }
  return count;
}

function insertReportForecastItems(forecastId: string, reportJson: ForecastJsonObject): number {
  return insertProbabilityItems(forecastId, reportJson.index_probabilities, "index_probability")
    + insertProbabilityItems(forecastId, reportJson.horizon_probabilities, "horizon_probability")
    + insertReportListItems(forecastId, reportJson.sector_opportunities, "sector_opportunity")
    + insertReportListItems(forecastId, reportJson.horizon_sector_opportunities, "horizon_sector_opportunity")
    + insertReportListItems(forecastId, reportJson.risk_alerts ?? reportJson.risks, "risk_alert")
    + insertReportListItems(forecastId, reportJson.horizon_risk_alerts, "horizon_risk_alert");
}

export function updateMarketForecastReport(forecastId: string, reportText: string): ReportForecastExtractionResult {
  const db = getDb();
  const reportJson = extractMarketForecastJsonFromReport(reportText);
  let insertedItemCount = 0;
  db.transaction(() => {
    db.prepare(
      `UPDATE market_forecasts
       SET report_text = @report_text,
           updated_at = datetime('now')
       WHERE id = @id`
    ).run({ id: forecastId, report_text: reportText });
    db.prepare("DELETE FROM market_forecast_items WHERE forecast_id = ? AND source = 'llm_report'").run(forecastId);
    if (reportJson) {
      insertedItemCount = insertReportForecastItems(forecastId, reportJson);
    }
  })();
  return { hasJson: Boolean(reportJson), insertedItemCount };
}

export function recordMarketForecastEvaluation(input: {
  id?: string;
  forecastId: string;
  evaluatedAt: string;
  outcome: unknown;
  score: unknown;
  notes?: string;
}): string {
  const id = input.id ?? uuid();
  getDb().prepare(
    `INSERT INTO market_forecast_evaluations (
      id, forecast_id, evaluated_at, outcome_json, score_json, notes
    ) VALUES (
      @id, @forecast_id, @evaluated_at, @outcome_json, @score_json, @notes
    )`
  ).run({
    id,
    forecast_id: input.forecastId,
    evaluated_at: input.evaluatedAt,
    outcome_json: JSON.stringify(input.outcome),
    score_json: JSON.stringify(input.score),
    notes: input.notes ?? null,
  });
  return id;
}

export function getMarketForecast(id: string): MarketForecastRow | undefined {
  return getDb().prepare("SELECT * FROM market_forecasts WHERE id = ?").get(id) as MarketForecastRow | undefined;
}

export function listRecentMarketForecasts(limit = 10): MarketForecastRow[] {
  return getDb()
    .prepare("SELECT * FROM market_forecasts ORDER BY generated_at DESC, created_at DESC LIMIT ?")
    .all(limit) as MarketForecastRow[];
}

export function findLatestMarketForecast(params: {
  marketScope: string;
  tradeDate?: string;
  session?: string;
}): MarketForecastRow | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM market_forecasts
       WHERE market_scope = @market_scope
         AND session = @session
         AND (@trade_date IS NULL OR trade_date = @trade_date)
       ORDER BY generated_at DESC, created_at DESC
       LIMIT 1`
    )
    .get({
      market_scope: params.marketScope,
      session: params.session ?? "pre_market",
      trade_date: params.tradeDate ?? null,
    }) as MarketForecastRow | undefined;
}

export function listMarketForecastItems(forecastId: string): MarketForecastItemRow[] {
  return getDb()
    .prepare("SELECT * FROM market_forecast_items WHERE forecast_id = ? ORDER BY created_at ASC, item_type ASC")
    .all(forecastId) as MarketForecastItemRow[];
}

export function listMarketForecastEvaluations(forecastId: string): MarketForecastEvaluationRow[] {
  return getDb()
    .prepare("SELECT * FROM market_forecast_evaluations WHERE forecast_id = ? ORDER BY evaluated_at ASC")
    .all(forecastId) as MarketForecastEvaluationRow[];
}

export function listMarketForecastCalibrationRecords(params: {
  marketScope?: string;
  since?: string;
  until?: string;
  limit?: number;
} = {}): MarketForecastCalibrationRecord[] {
  const clauses = ["1 = 1"];
  const values: Record<string, string | number> = {
    limit: Math.max(1, Math.min(500, params.limit ?? 100)),
  };
  if (params.marketScope) {
    clauses.push("market_scope = @market_scope");
    values.market_scope = params.marketScope;
  }
  if (params.since) {
    clauses.push("generated_at >= @since");
    values.since = params.since;
  }
  if (params.until) {
    clauses.push("generated_at <= @until");
    values.until = params.until;
  }

  const forecasts = getDb()
    .prepare(
      `SELECT * FROM market_forecasts
       WHERE ${clauses.join(" AND ")}
       ORDER BY generated_at DESC, created_at DESC
       LIMIT @limit`
    )
    .all(values) as MarketForecastRow[];

  return forecasts.map((forecast) => ({
    forecast,
    items: listMarketForecastItems(forecast.id),
    evaluations: listMarketForecastEvaluations(forecast.id),
  }));
}
