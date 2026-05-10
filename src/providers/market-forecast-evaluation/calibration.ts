import type {
  MarketForecastCalibrationRecord,
  MarketForecastEvaluationRow,
  MarketForecastItemRow,
} from "../../store/market-forecasts.js";
import type { MarketForecastEvaluationScore, MarketForecastOutcomeBucket } from "./types.js";

type AggregateKey = string;

export interface MarketForecastCalibrationGroup {
  key: string;
  forecasts: number;
  evaluated_forecasts: number;
  score_count: number;
  hit_count: number;
  miss_count: number;
  unknown_count: number;
  hit_rate?: number;
  avg_brier_score?: number;
}

export interface MarketForecastReliabilityWeight {
  source: string;
  samples: number;
  hit_rate?: number;
  avg_brier_score?: number;
  proposed_weight: number;
  confidence_cap?: number;
  rationale: string;
}

export interface MarketForecastCalibrationWeakSpots {
  unevaluated_forecasts: number;
  missing_probability_forecasts: number;
  missing_evidence_items: number;
  fallback_source_evaluations: number;
  high_brier_scores: number;
}

export interface MarketForecastCalibrationSummary {
  generated_at: string;
  window: {
    since?: string;
    until?: string;
    market_scope?: string;
    requested_days?: number;
  };
  totals: MarketForecastCalibrationGroup;
  by_market_scope: MarketForecastCalibrationGroup[];
  by_data_quality: MarketForecastCalibrationGroup[];
  by_forecast_source: MarketForecastCalibrationGroup[];
  source_reliability_weights: MarketForecastReliabilityWeight[];
  weak_spots: MarketForecastCalibrationWeakSpots;
  recommendations: string[];
}

interface ParsedEvaluation {
  row: MarketForecastEvaluationRow;
  scores: MarketForecastEvaluationScore[];
  fallbackSource: boolean;
}

interface MutableGroup {
  key: AggregateKey;
  forecasts: number;
  evaluatedForecastIds: Set<string>;
  scoreCount: number;
  hitCount: number;
  missCount: number;
  unknownCount: number;
  brierScores: number[];
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function isBucket(value: unknown): value is MarketForecastOutcomeBucket {
  return value === "up" || value === "range_bound" || value === "down" || value === "unknown";
}

function asEvaluationScore(value: unknown): MarketForecastEvaluationScore | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.target !== "string" || typeof row.benchmark_symbol !== "string") return undefined;
  if (!isBucket(row.predicted) || !isBucket(row.actual)) return undefined;
  const probabilities = row.probabilities;
  if (!probabilities || typeof probabilities !== "object" || Array.isArray(probabilities)) return undefined;
  const p = probabilities as Record<string, unknown>;
  if (typeof p.up !== "number" || typeof p.range_bound !== "number" || typeof p.down !== "number") return undefined;
  return {
    target: row.target,
    benchmark_symbol: row.benchmark_symbol,
    predicted: row.predicted,
    actual: row.actual,
    hit: row.hit === true,
    brier_score: typeof row.brier_score === "number" ? row.brier_score : undefined,
    probabilities: {
      up: p.up,
      range_bound: p.range_bound,
      down: p.down,
    },
  };
}

function latestEvaluation(evaluations: MarketForecastEvaluationRow[]): MarketForecastEvaluationRow | undefined {
  return [...evaluations].sort((a, b) => a.evaluated_at.localeCompare(b.evaluated_at)).at(-1);
}

function parseEvaluation(row: MarketForecastEvaluationRow | undefined): ParsedEvaluation | undefined {
  if (!row) return undefined;
  const scoreJson = parseJsonObject(row.score_json);
  const scores = Array.isArray(scoreJson?.scores)
    ? scoreJson.scores.map(asEvaluationScore).filter((score): score is MarketForecastEvaluationScore => Boolean(score))
    : [];
  const outcomeJson = parseJsonObject(row.outcome_json);
  const benchmarks = Array.isArray(outcomeJson?.benchmarks) ? outcomeJson.benchmarks : [];
  const fallbackSource = benchmarks.some((benchmark) => (
    benchmark
    && typeof benchmark === "object"
    && !Array.isArray(benchmark)
    && (benchmark as Record<string, unknown>).source === "yahoo_chart_unofficial"
  ));
  return { row, scores, fallbackSource };
}

function parseEvidenceIds(item: MarketForecastItemRow): string[] {
  try {
    const parsed = JSON.parse(item.evidence_ids_json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && value.length > 0) : [];
  } catch {
    return [];
  }
}

function forecastProbabilitySource(items: MarketForecastItemRow[]): string {
  if (items.some((item) => item.source === "llm_report" && item.item_type === "index_probability")) return "llm_report";
  if (items.some((item) => item.source === "provider_score" && item.item_type === "index_direction")) return "provider_score";
  return "none";
}

function hasProbabilityItems(items: MarketForecastItemRow[]): boolean {
  return items.some((item) => (
    (item.source === "llm_report" && item.item_type === "index_probability")
    || (item.source === "provider_score" && item.item_type === "index_direction")
  ));
}

function newGroup(key: string): MutableGroup {
  return {
    key,
    forecasts: 0,
    evaluatedForecastIds: new Set(),
    scoreCount: 0,
    hitCount: 0,
    missCount: 0,
    unknownCount: 0,
    brierScores: [],
  };
}

function addForecast(group: MutableGroup, forecastId: string, evaluation: ParsedEvaluation | undefined): void {
  group.forecasts++;
  if (!evaluation) return;
  if (evaluation.scores.length) group.evaluatedForecastIds.add(forecastId);
  for (const score of evaluation.scores) {
    group.scoreCount++;
    if (score.actual === "unknown") {
      group.unknownCount++;
    } else if (score.hit) {
      group.hitCount++;
    } else {
      group.missCount++;
    }
    if (typeof score.brier_score === "number") group.brierScores.push(score.brier_score);
  }
}

function finalizeGroup(group: MutableGroup): MarketForecastCalibrationGroup {
  const known = group.hitCount + group.missCount;
  return {
    key: group.key,
    forecasts: group.forecasts,
    evaluated_forecasts: group.evaluatedForecastIds.size,
    score_count: group.scoreCount,
    hit_count: group.hitCount,
    miss_count: group.missCount,
    unknown_count: group.unknownCount,
    hit_rate: known ? round(group.hitCount / known) : undefined,
    avg_brier_score: group.brierScores.length
      ? round(group.brierScores.reduce((sum, score) => sum + score, 0) / group.brierScores.length)
      : undefined,
  };
}

function groupMapValue(map: Map<string, MutableGroup>, key: string): MutableGroup {
  const existing = map.get(key);
  if (existing) return existing;
  const created = newGroup(key);
  map.set(key, created);
  return created;
}

function reliabilityWeight(group: MarketForecastCalibrationGroup): MarketForecastReliabilityWeight {
  if (group.evaluated_forecasts < 5 || group.hit_rate === undefined || group.avg_brier_score === undefined) {
    return {
      source: group.key,
      samples: group.evaluated_forecasts,
      hit_rate: group.hit_rate,
      avg_brier_score: group.avg_brier_score,
      proposed_weight: 1,
      rationale: "sample size below 5 evaluated forecasts; keep current scoring weight and keep collecting data.",
    };
  }
  if (group.hit_rate >= 0.6 && group.avg_brier_score <= 0.45) {
    return {
      source: group.key,
      samples: group.evaluated_forecasts,
      hit_rate: group.hit_rate,
      avg_brier_score: group.avg_brier_score,
      proposed_weight: 1.1,
      confidence_cap: 0.72,
      rationale: "recent evaluated forecasts show useful calibration; allow a small weight increase but keep confidence capped.",
    };
  }
  if (group.hit_rate < 0.45 || group.avg_brier_score >= 0.8) {
    return {
      source: group.key,
      samples: group.evaluated_forecasts,
      hit_rate: group.hit_rate,
      avg_brier_score: group.avg_brier_score,
      proposed_weight: 0.8,
      confidence_cap: 0.55,
      rationale: "recent evaluated forecasts are weak; down-weight this source and require stronger evidence before high conviction.",
    };
  }
  return {
    source: group.key,
    samples: group.evaluated_forecasts,
    hit_rate: group.hit_rate,
    avg_brier_score: group.avg_brier_score,
    proposed_weight: 1,
    confidence_cap: 0.65,
    rationale: "recent calibration is mixed; keep neutral weight and rely on explicit invalidation triggers.",
  };
}

function recommendations(summary: {
  totals: MarketForecastCalibrationGroup;
  weakSpots: MarketForecastCalibrationWeakSpots;
}): string[] {
  const out: string[] = [];
  if (!summary.totals.evaluated_forecasts) {
    out.push("No evaluated forecasts yet; keep the current prompts and collect post-market evaluation rows before changing weights.");
  }
  if (summary.weakSpots.unevaluated_forecasts) {
    out.push(`Backfill or wait for post-market evaluation on ${summary.weakSpots.unevaluated_forecasts} forecast(s) before judging accuracy.`);
  }
  if (summary.weakSpots.missing_probability_forecasts) {
    out.push("Tighten the Forecast Editor prompt: every pre-market report must emit index probability JSON for each benchmark target.");
  }
  if (summary.weakSpots.missing_evidence_items) {
    out.push("Tighten analyst role rules: forecast items without evidence IDs should be treated as hypotheses and excluded from high-conviction calls.");
  }
  if (summary.weakSpots.fallback_source_evaluations) {
    out.push("Evaluation currently uses fallback quote snapshots for some benchmarks; prioritize a primary close-source path before aggressive calibration.");
  }
  if (summary.weakSpots.high_brier_scores) {
    out.push("High Brier scores detected; lower confidence caps on the affected source/market until repeated misses are explained.");
  }
  if (!out.length) {
    out.push("No immediate calibration blocker detected; continue collecting data and review source weights weekly.");
  }
  return out;
}

export function summarizeMarketForecastCalibration(params: {
  records: MarketForecastCalibrationRecord[];
  generatedAt?: string;
  since?: string;
  until?: string;
  marketScope?: string;
  requestedDays?: number;
}): MarketForecastCalibrationSummary {
  const total = newGroup("all");
  const byMarket = new Map<string, MutableGroup>();
  const byQuality = new Map<string, MutableGroup>();
  const bySource = new Map<string, MutableGroup>();
  const weakSpots: MarketForecastCalibrationWeakSpots = {
    unevaluated_forecasts: 0,
    missing_probability_forecasts: 0,
    missing_evidence_items: 0,
    fallback_source_evaluations: 0,
    high_brier_scores: 0,
  };

  for (const record of params.records) {
    const evaluation = parseEvaluation(latestEvaluation(record.evaluations));
    const source = forecastProbabilitySource(record.items);
    addForecast(total, record.forecast.id, evaluation);
    addForecast(groupMapValue(byMarket, record.forecast.market_scope), record.forecast.id, evaluation);
    addForecast(groupMapValue(byQuality, record.forecast.data_quality_status ?? "unknown"), record.forecast.id, evaluation);
    addForecast(groupMapValue(bySource, source), record.forecast.id, evaluation);

    if (!evaluation?.scores.length) weakSpots.unevaluated_forecasts++;
    if (!hasProbabilityItems(record.items)) weakSpots.missing_probability_forecasts++;
    weakSpots.missing_evidence_items += record.items.filter((item) => (
      ["index_probability", "index_direction", "sector_opportunity", "risk_alert", "risk_level"].includes(item.item_type)
      && parseEvidenceIds(item).length === 0
    )).length;
    if (evaluation?.fallbackSource) weakSpots.fallback_source_evaluations++;
    weakSpots.high_brier_scores += evaluation?.scores.filter((score) => (score.brier_score ?? 0) >= 0.8).length ?? 0;
  }

  const totals = finalizeGroup(total);
  const byForecastSource = [...bySource.values()]
    .map(finalizeGroup)
    .sort((a, b) => b.evaluated_forecasts - a.evaluated_forecasts || a.key.localeCompare(b.key));

  return {
    generated_at: params.generatedAt ?? new Date().toISOString(),
    window: {
      since: params.since,
      until: params.until,
      market_scope: params.marketScope,
      requested_days: params.requestedDays,
    },
    totals,
    by_market_scope: [...byMarket.values()].map(finalizeGroup).sort((a, b) => a.key.localeCompare(b.key)),
    by_data_quality: [...byQuality.values()].map(finalizeGroup).sort((a, b) => a.key.localeCompare(b.key)),
    by_forecast_source: byForecastSource,
    source_reliability_weights: byForecastSource.map(reliabilityWeight),
    weak_spots: weakSpots,
    recommendations: recommendations({ totals, weakSpots }),
  };
}
