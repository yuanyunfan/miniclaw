import { beforeAll, describe, expect, it } from "vitest";
import { v4 as uuid } from "uuid";
import { createTask, initDb } from "../db.js";
import {
  extractMarketForecastJsonFromReport,
  getMarketForecast,
  listMarketForecastCalibrationRecords,
  listMarketForecastItems,
  recordMarketForecastEvaluation,
  recordMarketForecastFromPayload,
  stripMarketForecastJsonForDisplay,
  updateMarketForecastReport,
} from "../market-forecasts.js";
import type { MarketIntelPayload } from "../../providers/market-intel/types.js";

beforeAll(() => {
  initDb();
});

function payload(): MarketIntelPayload {
  return {
    generated_at: "2026-05-08T12:45:00.000Z",
    source: "market-intel",
    profile: "us-pre-market",
    market_scope: "us",
    session: "pre_market",
    run_context: {
      job_name: "us-stock-pre-market",
      channel_id: "channel-1",
      timezone: "America/New_York",
      calendar_status: "pre_market",
      trade_date: "2026-05-08",
      skipped: false,
      open_markets: [],
      tradable_markets: ["us"],
      closed_markets: [],
    },
    data_quality: {
      status: "partial",
      warnings: ["news collector partial"],
      sources: [],
    },
    scores: {
      index_direction: {
        target: "US broad market",
        direction: "bullish",
        probability: 0.58,
        confidence: 0.42,
        evidence_ids: ["quote.indices.1"],
        rationale: "Index snapshot is positive.",
        invalidation: "Futures reverse below prior close.",
      },
      sector_opportunities: [{
        target: "XLK",
        direction: "bullish",
        probability: 0.55,
        confidence: 0.25,
        evidence_ids: ["quote.sectors.1"],
        rationale: "XLK relative strength.",
      }],
      risk_level: {
        target: "market risk",
        direction: "neutral",
        probability: 0.5,
        confidence: 0.2,
        evidence_ids: ["calendar.static.1"],
        rationale: "No risk collector escalation.",
      },
    },
  } as unknown as MarketIntelPayload;
}

describe("market forecast persistence", () => {
  it("records a market-intel payload and provider score items", () => {
    const taskId = uuid();
    createTask({
      id: taskId,
      discord_thread_id: "",
      discord_user_id: "cron",
      prompt: "market forecast test",
      cwd: "/tmp",
    });
    const id = recordMarketForecastFromPayload({
      taskId,
      payload: payload(),
    });

    const row = getMarketForecast(id);
    expect(row?.task_id).toBe(taskId);
    expect(row?.market_scope).toBe("us");
    expect(row?.trade_date).toBe("2026-05-08");
    expect(row?.calendar_status).toBe("pre_market");
    expect(JSON.parse(row?.payload_json ?? "{}").source).toBe("market-intel");

    const items = listMarketForecastItems(id);
    expect(items.map((item) => item.item_type)).toEqual(expect.arrayContaining([
      "index_direction",
      "sector_opportunity",
      "risk_level",
    ]));
    expect(items.find((item) => item.item_type === "index_direction")?.probability).toBe(0.58);
  });

  it("updates report text and extracts compact LLM forecast JSON", () => {
    const id = recordMarketForecastFromPayload({ payload: payload() });
    const report = `
## Forecast Editor Synthesis
Base case...

<market_forecast_json>
{
  "index_probabilities": [
    {
      "target": "SPY",
      "up_probability": 45,
      "range_bound_probability": 35,
      "down_probability": 20,
      "confidence": 0.48,
      "evidence_ids": ["quote.indices.1"],
      "invalidation": "SPY loses prior close"
    }
  ],
  "sector_opportunities": [
    {
      "theme": "AI semiconductors",
      "direction": "watchlist",
      "probability": 0.54,
      "confidence": 0.3,
      "evidence_ids": ["quote.sectors.1"],
      "trigger": "SOXX confirms breakout"
    }
  ],
  "risk_alerts": [
    {
      "risk": "VIX reversal",
      "severity": "alert",
      "probability": 0.25,
      "confidence": 0.4,
      "evidence_ids": ["quote.macro.1"],
      "invalidation": "VIX stays below prior close"
    }
  ]
}
</market_forecast_json>`;

    const result = updateMarketForecastReport(id, report);

    expect(result).toEqual({ hasJson: true, insertedItemCount: 5 });
    expect(getMarketForecast(id)?.report_text).toContain("Forecast Editor Synthesis");
    const llmItems = listMarketForecastItems(id).filter((item) => item.source === "llm_report");
    expect(llmItems).toHaveLength(5);
    expect(llmItems.filter((item) => item.item_type === "index_probability").map((item) => item.direction)).toEqual([
      "up",
      "range_bound",
      "down",
    ]);
    expect(llmItems.find((item) => item.direction === "up")?.probability).toBe(0.45);
    expect(llmItems.find((item) => item.item_type === "risk_alert")?.target).toBe("VIX reversal");
  });

  it("stores medium and long horizon forecast JSON without forcing same-day item types", () => {
    const id = recordMarketForecastFromPayload({ payload: payload() });
    const report = `
<market_forecast_json>
{
  "horizon_probabilities": [
    {
      "horizon": "1m",
      "target": "SPY",
      "up_probability": 45,
      "range_bound_probability": 35,
      "down_probability": 20,
      "confidence": 0.42,
      "evidence_ids": ["quote.indices.1"],
      "base_case": "earnings breadth improves",
      "review_trigger": "monthly close"
    }
  ],
  "horizon_sector_opportunities": [
    {
      "horizon": "3m",
      "theme": "AI infrastructure",
      "direction": "watchlist",
      "probability": 0.56,
      "confidence": 0.35,
      "evidence_ids": ["quote.sectors.1"],
      "trigger": "capex revisions"
    }
  ],
  "horizon_risk_alerts": [
    {
      "horizon": "6m",
      "risk": "valuation compression",
      "severity": "alert",
      "probability": 0.4,
      "confidence": 0.34,
      "evidence_ids": ["quote.macro.1"],
      "invalidation": "earnings revisions reaccelerate"
    }
  ]
}
</market_forecast_json>`;

    const result = updateMarketForecastReport(id, report);

    expect(result).toEqual({ hasJson: true, insertedItemCount: 5 });
    const llmItems = listMarketForecastItems(id).filter((item) => item.source === "llm_report");
    expect(llmItems.filter((item) => item.item_type === "horizon_probability").map((item) => item.direction)).toEqual([
      "up",
      "range_bound",
      "down",
    ]);
    expect(llmItems.find((item) => item.item_type === "horizon_probability")?.target).toBe("1m | SPY");
    expect(llmItems.find((item) => item.item_type === "horizon_sector_opportunity")?.target).toBe("3m | AI infrastructure");
    expect(llmItems.find((item) => item.item_type === "horizon_risk_alert")?.target).toBe("6m | valuation compression");
  });

  it("extracts forecast JSON from fenced blocks", () => {
    const parsed = extractMarketForecastJsonFromReport([
      "```forecast_json",
      "{\"index_probabilities\":[{\"target\":\"QQQ\",\"up\":0.4,\"range_bound\":0.4,\"down\":0.2}]}",
      "```",
    ].join("\n"));

    expect(parsed?.index_probabilities).toBeDefined();
  });

  it("strips compact forecast JSON from user-facing display text", () => {
    const report = [
      "## Executive View",
      "Market up case is conditional.",
      "",
      "## Forecast JSON",
      "<market_forecast_json>",
      "{\"index_probabilities\":[{\"target\":\"SPY\",\"up\":0.4,\"range_bound\":0.4,\"down\":0.2}]}",
      "</market_forecast_json>",
    ].join("\n");

    const display = stripMarketForecastJsonForDisplay(report);

    expect(display).toContain("## Executive View");
    expect(display).toContain("Market up case is conditional.");
    expect(display).not.toContain("Forecast JSON");
    expect(display).not.toContain("market_forecast_json");
    expect(display).not.toContain("index_probabilities");
  });

  it("strips localized forecast JSON headings from user-facing display text", () => {
    const report = [
      "# 美股盘前报告 - 2026-05-11",
      "## 数据质量与来源",
      "新鲜来源：SEC、Fed。",
      "",
      "## 预测 JSON",
      "<market_forecast_json>",
      "{\"index_probabilities\":[{\"target\":\"SPY\",\"up\":0.4,\"range_bound\":0.4,\"down\":0.2}]}",
      "</market_forecast_json>",
    ].join("\n");

    const display = stripMarketForecastJsonForDisplay(report);

    expect(display).toContain("# 美股盘前报告 - 2026-05-11");
    expect(display).toContain("## 数据质量与来源");
    expect(display).not.toContain("预测 JSON");
    expect(display).not.toContain("market_forecast_json");
    expect(display).not.toContain("index_probabilities");
  });

  it("records evaluation rows for the post-market phase", () => {
    const id = recordMarketForecastFromPayload({ payload: payload() });
    const evaluationId = recordMarketForecastEvaluation({
      forecastId: id,
      evaluatedAt: "2026-05-08T21:00:00.000Z",
      outcome: { close_direction: "up" },
      score: { brier: 0.21 },
      notes: "fixture",
    });

    expect(evaluationId).toHaveLength(36);
  });

  it("lists forecast calibration records with items and evaluations", () => {
    const id = recordMarketForecastFromPayload({ payload: payload() });
    recordMarketForecastEvaluation({
      forecastId: id,
      evaluatedAt: "2026-05-08T21:00:00.000Z",
      outcome: { close_direction: "up" },
      score: { scores: [] },
    });

    const records = listMarketForecastCalibrationRecords({
      marketScope: "us",
      since: "2026-05-08T00:00:00.000Z",
      until: "2026-05-09T00:00:00.000Z",
      limit: 20,
    });
    const found = records.find((record) => record.forecast.id === id);

    expect(found?.items.length).toBeGreaterThan(0);
    expect(found?.evaluations.length).toBe(1);
  });
});
