import type {
  MarketIntelEvidenceItem,
  MarketIntelMarketSnapshot,
  MarketIntelScores,
  MarketIntelSnapshotItem,
} from "../../providers/market-intel/types.js";
import {
  calibrationRuleForSource,
  type MarketIntelScoringCalibrationConfig,
} from "../../providers/market-intel/calibration.js";

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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampProbability(value: number): number {
  return Math.round(Math.max(0.05, Math.min(0.95, value)) * 100) / 100;
}

function applyProviderCalibration<T extends MarketIntelScores["index_direction"]>(
  score: T,
  calibration: MarketIntelScoringCalibrationConfig | undefined,
): T {
  const rule = calibrationRuleForSource(calibration, "provider_score");
  if (!rule) return score;
  const probability = score.probability === undefined
    ? undefined
    : clampProbability(0.5 + (score.probability - 0.5) * rule.weight);
  const weightedConfidence = Math.max(0, Math.min(1, score.confidence * Math.min(rule.weight, 1.1)));
  const confidence = rule.confidence_cap === undefined
    ? weightedConfidence
    : Math.min(weightedConfidence, rule.confidence_cap);
  return {
    ...score,
    probability,
    confidence: Math.round(confidence * 100) / 100,
    rationale: `${score.rationale} Calibration applied for provider_score: weight=${rule.weight}, samples=${rule.samples}.`,
  };
}

function quoteDrivenIndexScore(params: {
  target: string;
  snapshot: MarketIntelMarketSnapshot;
  evidence: MarketIntelEvidenceItem[];
  calibration?: MarketIntelScoringCalibrationConfig;
}): MarketIntelScores["index_direction"] | undefined {
  const avg = averageChangePct(params.snapshot.indices.items);
  if (avg === undefined) return undefined;
  return applyProviderCalibration({
    target: params.target,
    direction: directionFromAverage(avg),
    probability: probabilityFromAverage(avg),
    confidence: round2(Math.min(0.65, 0.25 + params.snapshot.indices.items.filter((item) => !item.stale).length * 0.08)),
    evidence_ids: params.evidence.filter((item) => item.id.startsWith("quote.indices.")).map((item) => item.id),
    rationale: `Average non-stale index/watchlist change is ${avg}%. This is a mechanical pre-market score, not a trade signal.`,
    invalidation: "The score should change if official/primary quote sources disagree or macro/risk collectors produce offsetting evidence.",
  }, params.calibration);
}

function quoteEvidenceIdsForBucket(evidence: MarketIntelEvidenceItem[], bucket: string): string[] {
  return evidence.filter((item) => item.id.startsWith(`quote.${bucket}.`)).map((item) => item.id);
}

function quoteDrivenSectorScores(
  evidence: MarketIntelEvidenceItem[],
  snapshot: MarketIntelMarketSnapshot | undefined,
  calibration: MarketIntelScoringCalibrationConfig | undefined,
): MarketIntelScores["sector_opportunities"] {
  if (!snapshot) return [];
  const sectorEvidenceIds = quoteEvidenceIdsForBucket(evidence, "sectors");
  const macroEvidenceIds = quoteEvidenceIdsForBucket(evidence, "macro");
  return snapshot.sectors.items
    .filter((item) => !item.stale && item.change_pct !== undefined)
    .sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0))
    .slice(0, 5)
    .map((item) => applyProviderCalibration({
      target: item.symbol,
      direction: directionFromAverage(item.change_pct ?? 0),
      probability: probabilityFromAverage(item.change_pct ?? 0),
      confidence: macroEvidenceIds.length ? 0.32 : 0.25,
      evidence_ids: [...new Set([...sectorEvidenceIds, ...macroEvidenceIds])],
      rationale: `${item.symbol} quote change is ${item.change_pct}%; this is a mechanical sector relative-strength hint with explicit confidence cap.`,
      invalidation: "Downgrade to watchlist if sector quote strength is not confirmed by catalyst, breadth, or macro evidence.",
    }, calibration));
}

function riskFromMacroQuotes(snapshot: MarketIntelMarketSnapshot | undefined): {
  direction: "bearish" | "neutral";
  probability: number;
  confidence: number;
  rationale?: string;
} | undefined {
  if (!snapshot) return undefined;
  const vix = snapshot.macro.items.find((item) => item.symbol.toUpperCase() === "VIX" && !item.stale);
  if (vix?.change_pct !== undefined) {
    if (vix.change_pct >= 2) {
      return {
        direction: "bearish",
        probability: 0.62,
        confidence: 0.35,
        rationale: `VIX quote change is ${vix.change_pct}%, which mechanically raises risk-off probability.`,
      };
    }
    if (vix.change_pct <= -2) {
      return {
        direction: "neutral",
        probability: 0.46,
        confidence: 0.25,
        rationale: `VIX quote change is ${vix.change_pct}%, which mechanically lowers immediate volatility risk.`,
      };
    }
  }
  return undefined;
}

function riskScore(params: {
  evidence: MarketIntelEvidenceItem[];
  snapshot?: MarketIntelMarketSnapshot;
  calibration?: MarketIntelScoringCalibrationConfig;
}): MarketIntelScores["risk_level"] {
  const riskEvidence = params.evidence.filter((item) => item.category === "risk");
  const calendarEvidence = params.evidence.filter((item) => item.category === "calendar");
  const quoteRisk = riskFromMacroQuotes(params.snapshot);
  if (!riskEvidence.length && !quoteRisk) {
    return {
      target: "market risk",
      direction: calendarEvidence.length ? "neutral" : "insufficient_data",
      probability: calendarEvidence.length ? 0.5 : undefined,
      confidence: calendarEvidence.length ? 0.1 : 0,
      evidence_ids: calendarEvidence.map((item) => item.id),
      rationale: calendarEvidence.length
        ? "Calendar is known and no deterministic risk flags were derived from current official evidence."
        : "Calendar evidence is unavailable.",
      invalidation: "A derived official risk flag, volatility spike, policy event, or source failure appears in provider evidence.",
    };
  }
  const highCount = riskEvidence.filter((item) => item.importance === "high").length;
  const baseProbability = highCount ? Math.max(quoteRisk?.probability ?? 0, 0.64) : quoteRisk?.probability ?? 0.56;
  const baseConfidence = Math.min(0.58, (quoteRisk?.confidence ?? 0.2) + riskEvidence.length * 0.06 + highCount * 0.04);
  return applyProviderCalibration({
    target: "market risk",
    direction: highCount || quoteRisk?.direction === "bearish" ? "bearish" : "neutral",
    probability: baseProbability,
    confidence: baseConfidence,
    evidence_ids: [
      ...riskEvidence.map((item) => item.id),
      ...quoteEvidenceIdsForBucket(params.evidence, "macro"),
    ],
    rationale: quoteRisk?.rationale
      ? `${quoteRisk.rationale} Derived risk evidence count=${riskEvidence.length}, high_importance=${highCount}.`
      : `Derived risk evidence count=${riskEvidence.length}, high_importance=${highCount}.`,
    invalidation: "Risk score should fall if flagged event risk is resolved, volatility fades, or source failures recover.",
  }, params.calibration);
}

export function buildMarketIntelScores(params: {
  marketScope: "us" | "cn";
  evidence: MarketIntelEvidenceItem[];
  snapshot?: MarketIntelMarketSnapshot;
  calibration?: MarketIntelScoringCalibrationConfig;
}): MarketIntelScores {
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
    ? quoteDrivenIndexScore({ target, snapshot: params.snapshot, evidence: params.evidence, calibration: params.calibration })
    : undefined;
  return {
    index_direction: indexScore ?? scoreFromEvidence({
      target,
      evidence: directionalEvidence,
      rationale: "Only non-calendar evidence should drive directional scores.",
    }),
    sector_opportunities: quoteDrivenSectorScores(params.evidence, params.snapshot, params.calibration),
    risk_level: riskScore({ evidence: params.evidence, snapshot: params.snapshot, calibration: params.calibration }),
  };
}
