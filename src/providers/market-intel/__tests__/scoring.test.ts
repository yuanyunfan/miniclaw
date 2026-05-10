import { describe, expect, it } from "vitest";
import { buildMarketIntelScores } from "../scoring.js";
import type { MarketIntelEvidenceItem, MarketIntelMarketSnapshot } from "../types.js";

describe("buildMarketIntelScores", () => {
  it("returns insufficient_data without directional evidence", () => {
    const scores = buildMarketIntelScores({ marketScope: "us", evidence: [] });

    expect(scores.index_direction.direction).toBe("insufficient_data");
    expect(scores.index_direction.confidence).toBe(0);
    expect(scores.risk_level.direction).toBe("insufficient_data");
  });

  it("keeps calendar evidence out of directional scores", () => {
    const evidence: MarketIntelEvidenceItem[] = [{
      id: "calendar.static.1",
      category: "calendar",
      source: "static",
      source_tier: "official",
      captured_at: "2026-05-08T12:45:00.000Z",
      summary: "pre-market",
    }];

    const scores = buildMarketIntelScores({ marketScope: "cn", evidence });

    expect(scores.index_direction.direction).toBe("insufficient_data");
    expect(scores.risk_level.direction).toBe("neutral");
    expect(scores.risk_level.evidence_ids).toEqual(["calendar.static.1"]);
  });

  it("uses non-stale index quote changes for mechanical index score", () => {
    const evidence: MarketIntelEvidenceItem[] = [{
      id: "quote.indices.1",
      category: "quote",
      source: "mock_quotes",
      source_tier: "official",
      captured_at: "2026-05-08T12:45:00.000Z",
      summary: "indices",
    }];
    const empty = {
      status: "empty" as const,
      items: [],
      failures: [],
      notes: [],
    };
    const snapshot: MarketIntelMarketSnapshot = {
      indices: {
        status: "ok",
        items: [{
          symbol: "SPY",
          provider_symbol: "SPY",
          bucket: "indices",
          source: "mock_quotes",
          source_tier: "official",
          captured_at: "2026-05-08T12:45:00.000Z",
          latest_at: "2026-05-08T12:44:00.000Z",
          latest_price: 101,
          previous_close: 100,
          change_pct: 1,
          stale: false,
        }],
        failures: [],
        notes: [],
      },
      sectors: empty,
      macro: empty,
      cross_market: empty,
      symbols: empty,
    };

    const scores = buildMarketIntelScores({ marketScope: "us", evidence, snapshot });

    expect(scores.index_direction.direction).toBe("bullish");
    expect(scores.index_direction.probability).toBe(0.6);
    expect(scores.index_direction.evidence_ids).toEqual(["quote.indices.1"]);
  });

  it("uses derived risk evidence instead of a not-implemented risk placeholder", () => {
    const evidence: MarketIntelEvidenceItem[] = [
      {
        id: "calendar.static.1",
        category: "calendar",
        source: "static",
        source_tier: "official",
        captured_at: "2026-05-08T12:45:00.000Z",
        summary: "pre-market",
      },
      {
        id: "risk.derived.1",
        category: "risk",
        source: "market-intel derived risk flags",
        source_tier: "local_readonly",
        captured_at: "2026-05-08T12:45:00.000Z",
        summary: "Derived company_event_risk from filing.hkex.1",
        importance: "high",
      },
    ];

    const scores = buildMarketIntelScores({ marketScope: "cn", evidence });

    expect(scores.risk_level.direction).toBe("bearish");
    expect(scores.risk_level.evidence_ids).toContain("risk.derived.1");
    expect(scores.risk_level.rationale).not.toContain("not implemented");
  });
});
