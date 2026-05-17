import type { MarketForecastItemRow } from "../../store/market-forecasts.js";
import type {
  MarketForecastBenchmarkConfig,
  MarketForecastBenchmarkResult,
  MarketForecastEvaluationItemType,
  MarketForecastEvaluationScore,
  MarketForecastOutcomeBucket,
  MarketForecastProbabilityGroup,
} from "../../providers/market-forecast-evaluation/types.js";

export function normalizeProbabilities(input: {
  up: number;
  range_bound: number;
  down: number;
}): { up: number; range_bound: number; down: number } {
  const up = Number.isFinite(input.up) ? Math.max(0, input.up) : 0;
  const range = Number.isFinite(input.range_bound) ? Math.max(0, input.range_bound) : 0;
  const down = Number.isFinite(input.down) ? Math.max(0, input.down) : 0;
  const total = up + range + down;
  if (total <= 0) return { up: 1 / 3, range_bound: 1 / 3, down: 1 / 3 };
  return {
    up: Math.round((up / total) * 10000) / 10000,
    range_bound: Math.round((range / total) * 10000) / 10000,
    down: Math.round((down / total) * 10000) / 10000,
  };
}

function bucketFromProviderDirection(direction: string): "up" | "range_bound" | "down" {
  if (direction === "bullish" || direction === "up") return "up";
  if (direction === "bearish" || direction === "down" || direction === "risk" || direction === "alert" || direction === "urgent") return "down";
  return "range_bound";
}

function providerProbabilityGroup(item: MarketForecastItemRow): MarketForecastProbabilityGroup {
  const bucket = bucketFromProviderDirection(item.direction);
  const primary = item.probability ?? 0.5;
  const rest = Math.max(0, 1 - primary) / 2;
  return {
    target: item.target,
    source: item.source,
    confidence: item.confidence ?? undefined,
    ...normalizeProbabilities({
      up: bucket === "up" ? primary : rest,
      range_bound: bucket === "range_bound" ? primary : rest,
      down: bucket === "down" ? primary : rest,
    }),
  };
}

export function probabilityGroups(
  items: MarketForecastItemRow[],
  itemType: "index_probability" | "sector_opportunity" | "risk_alert",
): MarketForecastProbabilityGroup[] {
  const llm = items.filter((item) => item.source === "llm_report" && item.item_type === itemType);
  if (itemType !== "index_probability" && llm.length) {
    return llm.map(providerProbabilityGroup);
  }
  if (llm.length) {
    const grouped = new Map<string, MarketForecastProbabilityGroup>();
    for (const item of llm) {
      const current = grouped.get(item.target) ?? {
        target: item.target,
        source: "llm_report",
        up: 0,
        range_bound: 0,
        down: 0,
        confidence: item.confidence ?? undefined,
      };
      if (item.direction === "up") current.up = item.probability ?? 0;
      else if (item.direction === "range_bound") current.range_bound = item.probability ?? 0;
      else if (item.direction === "down") current.down = item.probability ?? 0;
      if (item.confidence !== null) current.confidence = item.confidence;
      grouped.set(item.target, current);
    }
    return [...grouped.values()].map((group) => ({
      ...group,
      ...normalizeProbabilities(group),
    }));
  }
  if (itemType === "risk_alert") {
    return items
      .filter((item) => item.source === "provider_score" && item.item_type === "risk_level")
      .map(providerProbabilityGroup);
  }
  return items
    .filter((item) => (
      item.source === "provider_score"
      && item.item_type === (itemType === "index_probability" ? "index_direction" : itemType)
    ))
    .map(providerProbabilityGroup);
}

function hasLlmItem(items: MarketForecastItemRow[], itemType: string): boolean {
  return items.some((item) => item.source === "llm_report" && item.item_type === itemType);
}

export function isHorizonOnlyForecast(items: MarketForecastItemRow[]): boolean {
  const hasHorizonForecast = ["horizon_probability", "horizon_sector_opportunity", "horizon_risk_alert"]
    .some((itemType) => hasLlmItem(items, itemType));
  const hasSameDayForecast = ["index_probability", "sector_opportunity", "risk_alert"]
    .some((itemType) => hasLlmItem(items, itemType));
  return hasHorizonForecast && !hasSameDayForecast;
}

export function changePct(latest?: number, previous?: number): number | undefined {
  if (latest === undefined || previous === undefined || previous === 0) return undefined;
  return Math.round(((latest - previous) / previous) * 10000) / 100;
}

export function outcomeBucket(change: number | undefined, thresholdPct: number): MarketForecastOutcomeBucket {
  if (change === undefined) return "unknown";
  if (change >= thresholdPct) return "up";
  if (change <= -thresholdPct) return "down";
  return "range_bound";
}

function predictedBucket(group: MarketForecastProbabilityGroup): MarketForecastOutcomeBucket {
  const entries: Array<[MarketForecastOutcomeBucket, number]> = [
    ["up", group.up],
    ["range_bound", group.range_bound],
    ["down", group.down],
  ];
  return entries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
}

function brierScore(group: MarketForecastProbabilityGroup, actual: MarketForecastOutcomeBucket): number | undefined {
  if (actual === "unknown") return undefined;
  const actuals = {
    up: actual === "up" ? 1 : 0,
    range_bound: actual === "range_bound" ? 1 : 0,
    down: actual === "down" ? 1 : 0,
  };
  const score = (group.up - actuals.up) ** 2
    + (group.range_bound - actuals.range_bound) ** 2
    + (group.down - actuals.down) ** 2;
  return Math.round(score * 10000) / 10000;
}

export function textMatchesBenchmark(
  target: string,
  benchmark: MarketForecastBenchmarkResult | MarketForecastBenchmarkConfig,
): boolean {
  const lowerTarget = target.toLowerCase();
  const lowerSymbol = benchmark.symbol.toLowerCase();
  const lowerLabel = benchmark.label?.toLowerCase();
  return lowerTarget.includes(lowerSymbol)
    || lowerSymbol.includes(lowerTarget)
    || (lowerLabel ? lowerTarget.includes(lowerLabel) || lowerLabel.includes(lowerTarget) : false);
}

function scoreForGroup(params: {
  itemType: MarketForecastEvaluationItemType;
  group: MarketForecastProbabilityGroup;
  benchmark: MarketForecastBenchmarkResult;
  details?: string;
}): MarketForecastEvaluationScore {
  const predicted = predictedBucket(params.group);
  return {
    item_type: params.itemType,
    target: params.group.target,
    benchmark_symbol: params.benchmark.symbol,
    predicted,
    actual: params.benchmark.outcome,
    hit: params.benchmark.outcome !== "unknown" && predicted === params.benchmark.outcome,
    brier_score: brierScore(params.group, params.benchmark.outcome),
    details: params.details,
    probabilities: {
      up: params.group.up,
      range_bound: params.group.range_bound,
      down: params.group.down,
    },
  };
}

export function indexEvaluationScores(
  groups: MarketForecastProbabilityGroup[],
  benchmarks: MarketForecastBenchmarkResult[],
): MarketForecastEvaluationScore[] {
  return groups.flatMap((group) => {
    const matched = benchmarks.filter((benchmark) => textMatchesBenchmark(group.target, benchmark));
    const selected = matched.length ? matched : benchmarks.slice(0, 1);
    return selected.map((benchmark) => scoreForGroup({ itemType: "index_direction", group, benchmark }));
  });
}

export function sectorEvaluationScores(
  groups: MarketForecastProbabilityGroup[],
  benchmarks: MarketForecastBenchmarkResult[],
): MarketForecastEvaluationScore[] {
  return groups.map((group) => {
    const benchmark = benchmarks.find((item) => textMatchesBenchmark(group.target, item));
    if (!benchmark) {
      return scoreForGroup({
        itemType: "sector_opportunity",
        group,
        benchmark: {
          symbol: "unmapped_sector_benchmark",
          provider_symbol: "unmapped_sector_benchmark",
          outcome: "unknown",
          source: "market-forecast-evaluation",
          error: "No benchmark_symbols entry matched this sector/theme target.",
        },
        details: "No benchmark_symbols entry matched this sector/theme target; add a sector ETF or proxy label to score it automatically.",
      });
    }
    return scoreForGroup({
      itemType: "sector_opportunity",
      group,
      benchmark,
      details: `Sector/theme target matched benchmark ${benchmark.symbol}${benchmark.label ? ` (${benchmark.label})` : ""}.`,
    });
  });
}

function riskProxyBenchmark(benchmarks: MarketForecastBenchmarkResult[]): MarketForecastBenchmarkResult {
  const known = benchmarks.filter((benchmark) => benchmark.outcome !== "unknown");
  if (!known.length) {
    return {
      symbol: "market_risk_proxy",
      provider_symbol: "market_risk_proxy",
      outcome: "unknown",
      source: "market-forecast-evaluation",
      error: "No known benchmark outcomes were available for risk proxy scoring.",
    };
  }
  const anyDown = known.some((benchmark) => benchmark.outcome === "down");
  const broadOutcome = anyDown ? "down" : "range_bound";
  return {
    symbol: "market_risk_proxy",
    provider_symbol: "market_risk_proxy",
    outcome: broadOutcome,
    source: "benchmark_composite",
    change_pct: known.filter((benchmark) => benchmark.outcome === "down").length,
  };
}

export function riskEvaluationScores(
  groups: MarketForecastProbabilityGroup[],
  benchmarks: MarketForecastBenchmarkResult[],
): MarketForecastEvaluationScore[] {
  const benchmark = riskProxyBenchmark(benchmarks);
  return groups.map((group) => scoreForGroup({
    itemType: "risk_alert",
    group,
    benchmark,
    details: benchmark.outcome === "down"
      ? "Risk proxy triggered because at least one configured benchmark closed below the downside threshold."
      : benchmark.outcome === "unknown"
        ? "Risk proxy could not be scored because benchmark outcomes are unknown."
        : "Risk proxy did not trigger because configured benchmarks avoided downside-threshold outcomes.",
  }));
}

export function calibrationNote(
  scores: MarketForecastEvaluationScore[],
  benchmarks: MarketForecastBenchmarkResult[],
): string {
  if (!scores.length) return "No probability, sector, or risk forecast was available to evaluate.";
  const known = scores.filter((score) => score.actual !== "unknown");
  if (!known.length) return "Benchmark quote data was unavailable, so no calibration score was produced.";
  const hits = known.filter((score) => score.hit).length;
  const briers = known.map((score) => score.brier_score).filter((score): score is number => score !== undefined);
  const avgBrier = briers.length
    ? Math.round((briers.reduce((sum, score) => sum + score, 0) / briers.length) * 10000) / 10000
    : undefined;
  const changes = benchmarks
    .filter((benchmark) => benchmark.change_pct !== undefined)
    .map((benchmark) => `${benchmark.symbol} ${benchmark.change_pct}% (${benchmark.outcome})`)
    .join("; ");
  const byType = [...new Set(known.map((score) => score.item_type))]
    .map((type) => {
      const subset = known.filter((score) => score.item_type === type);
      return `${type} ${subset.filter((score) => score.hit).length}/${subset.length}`;
    })
    .join("; ");
  return `Forecast scoring hit ${hits}/${known.length}${avgBrier !== undefined ? `, avg Brier ${avgBrier}` : ""}${byType ? ` (${byType})` : ""}.${changes ? ` Benchmarks: ${changes}.` : ""}`;
}
