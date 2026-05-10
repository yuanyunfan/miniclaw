import { describe, expect, it, vi } from "vitest";
import { runMarketForecastEvaluationProvider, __testables } from "../index.js";
import type { MarketForecastItemRow, MarketForecastRow } from "../../../store/market-forecasts.js";
import type { MarketForecastEvaluationProviderConfig, MarketForecastEvaluationQuoteClient } from "../types.js";

function config(): MarketForecastEvaluationProviderConfig {
  return {
    market_scope: "us",
    timezone: "America/New_York",
    forecast_session: "pre_market",
    portfolio_provider_config: "us-stock",
    direction_threshold_pct: 0.2,
    benchmark_symbols: [{ symbol: "SPY", provider_symbol: "SPY", label: "S&P 500 ETF" }],
  };
}

function forecast(): MarketForecastRow {
  return {
    id: "forecast-1",
    task_id: "task-1",
    job_name: "us-stock-pre-market",
    channel_id: "channel-1",
    market_scope: "us",
    trade_date: "2026-05-08",
    session: "pre_market",
    generated_at: "2026-05-08T12:45:00.000Z",
    calendar_status: "pre_market",
    data_quality_status: "partial",
    payload_json: "{}",
    report_text: "report",
    created_at: "2026-05-08T12:45:00.000Z",
    updated_at: "2026-05-08T12:45:00.000Z",
  };
}

function item(direction: "up" | "range_bound" | "down", probability: number): MarketForecastItemRow {
  return {
    id: `item-${direction}`,
    forecast_id: "forecast-1",
    item_type: "index_probability",
    target: "SPY",
    direction,
    probability,
    confidence: 0.5,
    evidence_ids_json: "[]",
    invalidation: null,
    rationale: null,
    source: "llm_report",
    created_at: "2026-05-08T12:45:00.000Z",
  };
}

const quoteClient: MarketForecastEvaluationQuoteClient = {
  source: "mock_quotes",
  source_tier: "official",
  async getSnapshot(request) {
    return {
      symbol: request.symbol,
      provider_symbol: request.provider_symbol,
      latest_at: "2026-05-08T20:00:00.000Z",
      latest_price: 104,
      previous_close: 100,
      currency: "USD",
    };
  },
};

describe("runMarketForecastEvaluationProvider", () => {
  it("evaluates stored LLM probabilities and defers DB writes to commit", async () => {
    let portfolioCommitted = false;
    const recordEvaluation = vi.fn(() => "evaluation-1");
    const result = await runMarketForecastEvaluationProvider({
      configName: "us-post-market",
      jobName: "us-stock-post-market",
      channelId: "channel-1",
      runAt: new Date("2026-05-08T20:30:00.000Z"),
    }, {
      loadProviderConfig: () => config(),
      quoteClient,
      findForecast: () => forecast(),
      listItems: () => [item("up", 0.6), item("range_bound", 0.3), item("down", 0.1)],
      recordEvaluation,
      portfolioRunner: async () => ({
        text: JSON.stringify({ source: "stock-portfolio", profile: "us-stock", ok_count: 1, failed_count: 0 }),
        commit: async () => { portfolioCommitted = true; },
      }),
    });

    const parsed = JSON.parse(result.text);
    expect(parsed.source).toBe("market-forecast-evaluation");
    expect(parsed.status).toBe("ok");
    expect(parsed.stock_portfolio.profile).toBe("us-stock");
    expect(parsed.scores[0]).toMatchObject({
      target: "SPY",
      benchmark_symbol: "SPY",
      predicted: "up",
      actual: "up",
      hit: true,
    });
    expect(parsed.scores[0].brier_score).toBeCloseTo(0.26);
    expect(recordEvaluation).not.toHaveBeenCalled();

    await result.commit?.();

    expect(recordEvaluation).toHaveBeenCalledWith(expect.objectContaining({
      forecastId: "forecast-1",
      outcome: expect.objectContaining({ benchmarks: expect.any(Array) }),
      score: expect.objectContaining({ scores: expect.any(Array) }),
    }));
    expect(portfolioCommitted).toBe(true);
  });

  it("reports no_forecast without recording an evaluation", async () => {
    const recordEvaluation = vi.fn(() => "evaluation-1");
    const result = await runMarketForecastEvaluationProvider({
      configName: "us-post-market",
      jobName: "us-stock-post-market",
      channelId: "channel-1",
      runAt: new Date("2026-05-08T20:30:00.000Z"),
    }, {
      loadProviderConfig: () => ({ ...config(), portfolio_provider_config: undefined }),
      quoteClient,
      findForecast: () => undefined,
      recordEvaluation,
    });

    const parsed = JSON.parse(result.text);
    expect(parsed.status).toBe("no_forecast");
    expect(parsed.data_quality.warnings).toContain("no matching pre-market forecast found for this trade date.");
    await result.commit?.();
    expect(recordEvaluation).not.toHaveBeenCalled();
  });
});

describe("market forecast evaluation helpers", () => {
  it("uses range_bound inside the configured threshold", () => {
    expect(__testables.outcomeBucket(0.1, 0.2)).toBe("range_bound");
    expect(__testables.outcomeBucket(-0.3, 0.2)).toBe("down");
  });
});
