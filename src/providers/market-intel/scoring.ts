import type { MarketIntelEvidenceItem, MarketIntelMarketSnapshot, MarketIntelScores, MarketIntelSnapshotItem } from "./types.js";

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

function averageChangePct(items: MarketIntelSnapshotItem[]): number | undefined {
  const values = items
    .filter((item) => !item.stale && item.change_pct !== undefined)
    .map((item) => item.change_pct as number);
  if (!values.length) return undefined;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function directionFromAverage(avg: number): "bullish" | "bearish" | "neutral" {
  if (avg >= 0.3) return "bullish";
  if (avg <= -0.3) return "bearish";
  return "neutral";
}

function probabilityFromAverage(avg: number): number {
  const clamped = Math.max(-2, Math.min(2, avg));
  return Math.round((0.5 + clamped / 10) * 100) / 100;
}

function quoteDrivenIndexScore(params: {
  target: string;
  snapshot: MarketIntelMarketSnapshot;
  evidence: MarketIntelEvidenceItem[];
}): MarketIntelScores["index_direction"] | undefined {
  const avg = averageChangePct(params.snapshot.indices.items);
  if (avg === undefined) return undefined;
  return {
    target: params.target,
    direction: directionFromAverage(avg),
    probability: probabilityFromAverage(avg),
    confidence: Math.min(0.65, 0.25 + params.snapshot.indices.items.filter((item) => !item.stale).length * 0.08),
    evidence_ids: params.evidence.filter((item) => item.id.startsWith("quote.indices.")).map((item) => item.id),
    rationale: `Average non-stale index/watchlist change is ${avg}%. This is a mechanical pre-market score, not a trade signal.`,
    invalidation: "The score should change if official/primary quote sources disagree or macro/risk collectors produce offsetting evidence.",
  };
}

function quoteDrivenSectorScores(evidence: MarketIntelEvidenceItem[], snapshot?: MarketIntelMarketSnapshot): MarketIntelScores["sector_opportunities"] {
  if (!snapshot) return [];
  const evidenceIds = evidence.filter((item) => item.id.startsWith("quote.sectors.")).map((item) => item.id);
  return snapshot.sectors.items
    .filter((item) => !item.stale && item.change_pct !== undefined)
    .sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0))
    .slice(0, 5)
    .map((item) => ({
      target: item.symbol,
      direction: directionFromAverage(item.change_pct ?? 0),
      probability: probabilityFromAverage(item.change_pct ?? 0),
      confidence: 0.25,
      evidence_ids: evidenceIds,
      rationale: `${item.symbol} quote change is ${item.change_pct}%; this is only a mechanical sector relative-strength hint.`,
      invalidation: "Do not use as a sector call until sector breadth/news/fundamental collectors confirm it.",
    }));
}

export function buildMarketIntelScores(params: {
  marketScope: "us" | "cn";
  evidence: MarketIntelEvidenceItem[];
  snapshot?: MarketIntelMarketSnapshot;
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
  const indexScore = params.snapshot
    ? quoteDrivenIndexScore({ target, snapshot: params.snapshot, evidence: params.evidence })
    : undefined;
  return {
    index_direction: indexScore ?? scoreFromEvidence({
      target,
      evidence: directionalEvidence,
      rationale: "Only non-calendar evidence should drive directional scores.",
    }),
    sector_opportunities: quoteDrivenSectorScores(params.evidence, params.snapshot),
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
