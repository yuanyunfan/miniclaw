import { describe, expect, it } from "vitest";
import { buildMarketIntelScores } from "../scoring.js";
import type { MarketIntelEvidenceItem } from "../types.js";

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
});
