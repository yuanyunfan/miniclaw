import { describe, expect, it } from "vitest";
import { buildMarketIntelScoringCalibrationConfig, summarizeMarketForecastCalibration } from "../calibration.js";
import type {
  MarketForecastCalibrationRecord,
  MarketForecastEvaluationRow,
  MarketForecastItemRow,
  MarketForecastRow,
} from "../../../store/market-forecasts.js";

function forecast(overrides: Partial<MarketForecastRow> = {}): MarketForecastRow {
  return {
    id: "forecast-1",
    task_id: null,
    job_name: "us-stock-pre-market",
    channel_id: "channel-1",
    market_scope: "us",
    trade_date: "2026-05-08",
    session: "pre_market",
    generated_at: "2026-05-08T12:45:00.000Z",
    calendar_status: "pre_market",
    data_quality_status: "partial",
    payload_json: "{}",
    report_text: null,
    created_at: "2026-05-08T12:45:00.000Z",
    updated_at: "2026-05-08T12:45:00.000Z",
    ...overrides,
  };
}

function item(overrides: Partial<MarketForecastItemRow> = {}): MarketForecastItemRow {
  return {
    id: "item-1",
    forecast_id: "forecast-1",
    item_type: "index_probability",
    target: "SPY",
    direction: "up",
    probability: 0.6,
    confidence: 0.5,
    evidence_ids_json: JSON.stringify(["quote.indices.1"]),
    invalidation: null,
    rationale: null,
    source: "llm_report",
    created_at: "2026-05-08T12:46:00.000Z",
    ...overrides,
  };
}

function evaluation(overrides: Partial<MarketForecastEvaluationRow> = {}): MarketForecastEvaluationRow {
  return {
    id: "evaluation-1",
    forecast_id: "forecast-1",
    evaluated_at: "2026-05-08T21:05:00.000Z",
    outcome_json: JSON.stringify({
      benchmarks: [{
        symbol: "SPY",
        outcome: "up",
        source: "official_close",
      }],
    }),
    score_json: JSON.stringify({
      scores: [{
        item_type: "index_direction",
        target: "SPY",
        benchmark_symbol: "SPY",
        predicted: "up",
        actual: "up",
        hit: true,
        brier_score: 0.24,
        probabilities: { up: 0.6, range_bound: 0.25, down: 0.15 },
      }],
      calibration_note: "hit",
    }),
    notes: "hit",
    created_at: "2026-05-08T21:05:00.000Z",
    ...overrides,
  };
}

describe("market forecast calibration summary", () => {
  it("summarizes evaluated forecast accuracy by market, quality, and source", () => {
    const summary = summarizeMarketForecastCalibration({
      generatedAt: "2026-05-10T00:00:00.000Z",
      records: [{
        forecast: forecast(),
        items: [
          item({ direction: "up", probability: 0.6 }),
          item({ id: "item-2", direction: "range_bound", probability: 0.25 }),
          item({ id: "item-3", direction: "down", probability: 0.15 }),
        ],
        evaluations: [evaluation()],
      }],
      requestedDays: 7,
    });

    expect(summary.totals).toMatchObject({
      forecasts: 1,
      evaluated_forecasts: 1,
      score_count: 1,
      hit_count: 1,
      hit_rate: 1,
      avg_brier_score: 0.24,
    });
    expect(summary.by_market_scope[0]?.key).toBe("us");
    expect(summary.by_data_quality[0]?.key).toBe("partial");
    expect(summary.by_forecast_source[0]?.key).toBe("llm_report");
    expect(summary.by_score_type[0]?.key).toBe("index_direction");
    expect(summary.source_reliability_weights[0]?.proposed_weight).toBe(1);
  });

  it("flags weak spots before enough calibration data exists", () => {
    const records: MarketForecastCalibrationRecord[] = [{
      forecast: forecast({ id: "forecast-2", data_quality_status: "blocked" }),
      items: [item({
        id: "item-4",
        forecast_id: "forecast-2",
        item_type: "sector_opportunity",
        source: "llm_report",
        evidence_ids_json: "[]",
      })],
      evaluations: [],
    }];

    const summary = summarizeMarketForecastCalibration({ records });

    expect(summary.weak_spots).toMatchObject({
      unevaluated_forecasts: 1,
      missing_probability_forecasts: 1,
      missing_evidence_items: 1,
    });
    expect(summary.recommendations.join("\n")).toContain("No evaluated forecasts yet");
    expect(summary.recommendations.join("\n")).toContain("index_probabilities or horizon_probabilities JSON");
  });

  it("uses the latest evaluation row and counts fallback quote calibration", () => {
    const oldMiss = evaluation({
      id: "evaluation-old",
      evaluated_at: "2026-05-08T20:00:00.000Z",
      score_json: JSON.stringify({
        scores: [{
          item_type: "index_direction",
          target: "SPY",
          benchmark_symbol: "SPY",
          predicted: "up",
          actual: "down",
          hit: false,
          brier_score: 1.2,
          probabilities: { up: 0.8, range_bound: 0.1, down: 0.1 },
        }],
      }),
    });
    const latestHit = evaluation({
      id: "evaluation-new",
      evaluated_at: "2026-05-08T21:00:00.000Z",
      outcome_json: JSON.stringify({
        benchmarks: [{ symbol: "SPY", outcome: "up", source: "yahoo_chart_unofficial" }],
      }),
    });

    const summary = summarizeMarketForecastCalibration({
      records: [{
        forecast: forecast(),
        items: [item()],
        evaluations: [oldMiss, latestHit],
      }],
    });

    expect(summary.totals.hit_count).toBe(1);
    expect(summary.totals.miss_count).toBe(0);
    expect(summary.weak_spots.fallback_source_evaluations).toBe(1);
    expect(summary.weak_spots.high_brier_scores).toBe(0);
  });

  it("treats horizon probabilities as forecast probabilities, not missing same-day JSON", () => {
    const summary = summarizeMarketForecastCalibration({
      records: [{
        forecast: forecast(),
        items: [
          item({
            id: "horizon-1",
            item_type: "horizon_probability",
            target: "1m | SPY",
            direction: "up",
            source: "llm_report",
            evidence_ids_json: JSON.stringify(["quote.indices.1"]),
          }),
        ],
        evaluations: [],
      }],
    });

    expect(summary.by_forecast_source[0]?.key).toBe("llm_horizon_report");
    expect(summary.weak_spots.missing_probability_forecasts).toBe(0);
    expect(summary.weak_spots.unevaluated_forecasts).toBe(1);
  });

  it("builds runtime calibration config only after the sample gate", () => {
    const records: MarketForecastCalibrationRecord[] = Array.from({ length: 5 }, (_, index) => ({
      forecast: forecast({ id: `forecast-${index}`, data_quality_status: "ok" }),
      items: [item({ forecast_id: `forecast-${index}` })],
      evaluations: [evaluation({
        id: `evaluation-${index}`,
        forecast_id: `forecast-${index}`,
        score_json: JSON.stringify({
          scores: [{
            item_type: "index_direction",
            target: "SPY",
            benchmark_symbol: "SPY",
            predicted: "up",
            actual: "up",
            hit: true,
            brier_score: 0.2,
            probabilities: { up: 0.7, range_bound: 0.2, down: 0.1 },
          }],
        }),
      })],
    }));

    const summary = summarizeMarketForecastCalibration({ records, generatedAt: "2026-05-10T00:00:00.000Z" });
    const config = buildMarketIntelScoringCalibrationConfig(summary, { minSamples: 5 });

    expect(config.source_weights[0]).toMatchObject({
      source: "llm_report",
      weight: 1.1,
      samples: 5,
    });
  });
});
