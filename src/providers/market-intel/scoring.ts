import type { MarketIntelEvidenceItem, MarketIntelScores } from "./types.js";

function scoreFromEvidence(params: {
  target: string;
  evidence: MarketIntelEvidenceItem[];
  rationale: string;
}): MarketIntelScores["index_direction"] {
  if (!params.evidence.length) {
    return {
      target: params.target,
      direction: "insufficient_data",
      confidence: 0,
      evidence_ids: [],
      rationale: "No implemented market-intel collectors produced evidence for this target yet.",
    };
  }
  return {
    target: params.target,
    direction: "neutral",
    probability: 0.5,
    confidence: 0.2,
    evidence_ids: params.evidence.map((item) => item.id),
    rationale: params.rationale,
    invalidation: "A live quote, macro, sector, or risk collector emits directional evidence.",
  };
}

export function buildMarketIntelScores(params: {
  marketScope: "us" | "cn";
  evidence: MarketIntelEvidenceItem[];
}): MarketIntelScores {
  const calendarEvidence = params.evidence.filter((item) => item.category === "calendar");
  const directionalEvidence = params.evidence.filter((item) => (
    item.category === "quote" ||
    item.category === "macro" ||
    item.category === "news" ||
    item.category === "earnings" ||
    item.category === "filing" ||
    item.category === "sector" ||
    item.category === "risk"
  ));
  const target = params.marketScope === "us" ? "US broad market" : "CN/HK broad market";
  return {
    index_direction: scoreFromEvidence({
      target,
      evidence: directionalEvidence,
      rationale: "Only non-calendar evidence should drive directional scores.",
    }),
    sector_opportunities: [],
    risk_level: {
      target: "market risk",
      direction: calendarEvidence.length ? "neutral" : "insufficient_data",
      probability: calendarEvidence.length ? 0.5 : undefined,
      confidence: calendarEvidence.length ? 0.1 : 0,
      evidence_ids: calendarEvidence.map((item) => item.id),
      rationale: calendarEvidence.length
        ? "Calendar is known, but risk collectors are not implemented in the provider skeleton."
        : "Calendar evidence is unavailable.",
      invalidation: "Implemented risk collectors produce volatility, liquidity, policy, or event-risk evidence.",
    },
  };
}
