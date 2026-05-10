import type { PreProviderResult, PreProviderRunArgs } from "../types.js";
import { runStockPortfolioProvider } from "../stock-portfolio/index.js";
import { zonedDateKey } from "../market-intel/calendar.js";
import { sanitizeMarketIntelError } from "../market-intel/format.js";
import { YahooMarketIntelQuoteClient } from "../market-intel/quotes.js";
import {
  findLatestMarketForecast,
  listMarketForecastItems,
  recordMarketForecastEvaluation,
  type MarketForecastItemRow,
  type MarketForecastRow,
} from "../../store/market-forecasts.js";
import { loadMarketForecastEvaluationProviderConfig } from "./config.js";
import type {
  MarketForecastBenchmarkConfig,
  MarketForecastBenchmarkResult,
  MarketForecastEvaluationItemType,
  MarketForecastEvaluationPortfolioRunner,
  MarketForecastEvaluationProviderConfig,
  MarketForecastEvaluationQuoteClient,
  MarketForecastEvaluationQuoteInput,
  MarketForecastEvaluationScore,
  MarketForecastOutcomeBucket,
  MarketForecastProbabilityGroup,
} from "./types.js";

class YahooEvaluationQuoteClient implements MarketForecastEvaluationQuoteClient {
  readonly source = "yahoo_chart_unofficial";
  readonly source_tier = "fallback";
  private readonly client = new YahooMarketIntelQuoteClient();

  async getSnapshot(request: MarketForecastBenchmarkConfig & { provider_symbol: string }): Promise<MarketForecastEvaluationQuoteInput> {
    return await this.client.getSnapshot({
      symbol: request.symbol,
      provider_symbol: request.provider_symbol,
      bucket: "indices",
    });
  }
}

export interface MarketForecastEvaluationProviderDeps {
  loadProviderConfig?: (name?: string) => MarketForecastEvaluationProviderConfig;
  portfolioRunner?: MarketForecastEvaluationPortfolioRunner;
  quoteClient?: MarketForecastEvaluationQuoteClient;
  findForecast?: typeof findLatestMarketForecast;
  listItems?: typeof listMarketForecastItems;
  recordEvaluation?: typeof recordMarketForecastEvaluation;
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("payload is not an object");
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(`${label} returned invalid JSON: ${sanitizeMarketIntelError(err)}`);
  }
}

function normalizeProbabilities(input: { up: number; range_bound: number; down: number }): { up: number; range_bound: number; down: number } {
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

function probabilityGroups(
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

function changePct(latest?: number, previous?: number): number | undefined {
  if (latest === undefined || previous === undefined || previous === 0) return undefined;
  return Math.round(((latest - previous) / previous) * 10000) / 100;
}

function outcomeBucket(change: number | undefined, thresholdPct: number): MarketForecastOutcomeBucket {
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

function textMatchesBenchmark(target: string, benchmark: MarketForecastBenchmarkResult | MarketForecastBenchmarkConfig): boolean {
  const lowerTarget = target.toLowerCase();
  const lowerSymbol = benchmark.symbol.toLowerCase();
  const lowerLabel = benchmark.label?.toLowerCase();
  return lowerTarget.includes(lowerSymbol)
    || lowerSymbol.includes(lowerTarget)
    || (lowerLabel ? lowerTarget.includes(lowerLabel) || lowerLabel.includes(lowerTarget) : false);
}

async function benchmarkResults(params: {
  config: MarketForecastEvaluationProviderConfig;
  quoteClient: MarketForecastEvaluationQuoteClient;
}): Promise<MarketForecastBenchmarkResult[]> {
  const out: MarketForecastBenchmarkResult[] = [];
  for (const benchmark of params.config.benchmark_symbols) {
    const providerSymbol = benchmark.provider_symbol ?? benchmark.symbol;
    try {
      const quote = await params.quoteClient.getSnapshot({ ...benchmark, provider_symbol: providerSymbol });
      const pct = changePct(quote.latest_price, quote.previous_close);
      out.push({
        symbol: benchmark.symbol,
        provider_symbol: providerSymbol,
        label: benchmark.label,
        latest_at: quote.latest_at,
        latest_price: quote.latest_price,
        previous_close: quote.previous_close,
        change_pct: pct,
        outcome: outcomeBucket(pct, params.config.direction_threshold_pct),
        source: params.quoteClient.source,
      });
    } catch (err) {
      out.push({
        symbol: benchmark.symbol,
        provider_symbol: providerSymbol,
        label: benchmark.label,
        outcome: "unknown",
        source: params.quoteClient.source,
        error: sanitizeMarketIntelError(err),
      });
    }
  }
  return out;
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

function indexEvaluationScores(groups: MarketForecastProbabilityGroup[], benchmarks: MarketForecastBenchmarkResult[]): MarketForecastEvaluationScore[] {
  return groups.flatMap((group) => {
    const matched = benchmarks.filter((benchmark) => textMatchesBenchmark(group.target, benchmark));
    const selected = matched.length ? matched : benchmarks.slice(0, 1);
    return selected.map((benchmark) => scoreForGroup({ itemType: "index_direction", group, benchmark }));
  });
}

function sectorEvaluationScores(groups: MarketForecastProbabilityGroup[], benchmarks: MarketForecastBenchmarkResult[]): MarketForecastEvaluationScore[] {
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

function riskEvaluationScores(groups: MarketForecastProbabilityGroup[], benchmarks: MarketForecastBenchmarkResult[]): MarketForecastEvaluationScore[] {
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

function calibrationNote(scores: MarketForecastEvaluationScore[], benchmarks: MarketForecastBenchmarkResult[]): string {
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

function payloadJson(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export async function runMarketForecastEvaluationProvider(
  args: PreProviderRunArgs,
  deps: MarketForecastEvaluationProviderDeps = {},
): Promise<PreProviderResult> {
  const configName = args.configName ?? "default";
  const config = (deps.loadProviderConfig ?? loadMarketForecastEvaluationProviderConfig)(configName);
  const tradeDate = zonedDateKey(args.runAt, config.timezone);
  const quoteClient = deps.quoteClient ?? new YahooEvaluationQuoteClient();
  const portfolioResult = config.portfolio_provider_config
    ? await (deps.portfolioRunner ?? runStockPortfolioProvider)({ ...args, configName: config.portfolio_provider_config })
    : undefined;
  const portfolioPayload = portfolioResult
    ? parseJsonObject(portfolioResult.text, "stock-portfolio")
    : undefined;
  const forecast = (deps.findForecast ?? findLatestMarketForecast)({
    marketScope: config.market_scope,
    tradeDate,
    session: config.forecast_session,
  });
  const items = forecast ? (deps.listItems ?? listMarketForecastItems)(forecast.id) : [];
  const groups = probabilityGroups(items, "index_probability");
  const sectorGroups = probabilityGroups(items, "sector_opportunity");
  const riskGroups = probabilityGroups(items, "risk_alert");
  const benchmarks = await benchmarkResults({ config, quoteClient });
  const indexScores = indexEvaluationScores(groups, benchmarks);
  const sectorScores = sectorEvaluationScores(sectorGroups, benchmarks);
  const riskScores = riskEvaluationScores(riskGroups, benchmarks);
  const scores = [...indexScores, ...sectorScores, ...riskScores];
  const note = calibrationNote(scores, benchmarks);
  const status = !forecast
    ? "no_forecast"
    : !groups.length
      ? "no_probability_items"
      : benchmarks.some((benchmark) => benchmark.outcome === "unknown")
        ? "partial"
        : "ok";
  const payload = {
    generated_at: args.runAt.toISOString(),
    source: "market-forecast-evaluation",
    profile: configName,
    market_scope: config.market_scope,
    trade_date: tradeDate,
    status,
    stock_portfolio: portfolioPayload,
    forecast: forecast
      ? {
        id: forecast.id,
        task_id: forecast.task_id,
        generated_at: forecast.generated_at,
        calendar_status: forecast.calendar_status,
        data_quality_status: forecast.data_quality_status,
      }
      : undefined,
    probability_groups: groups,
    sector_probability_groups: sectorGroups,
    risk_probability_groups: riskGroups,
    benchmark_results: benchmarks,
    scores,
    score_groups: {
      index_direction: indexScores,
      sector_opportunity: sectorScores,
      risk_alert: riskScores,
    },
    calibration_note: note,
    data_quality: {
      quote_source: quoteClient.source,
      warnings: [
        quoteClient.source_tier === "fallback"
          ? "evaluation quotes use a fallback source; treat calibration as provisional until primary close data is available."
          : undefined,
        !forecast ? "no matching pre-market forecast found for this trade date." : undefined,
        !groups.length && forecast ? "matching forecast has no stored index probability items." : undefined,
        !sectorGroups.length && forecast ? "matching forecast has no stored sector opportunity items." : undefined,
        sectorScores.some((score) => score.benchmark_symbol === "unmapped_sector_benchmark")
          ? "some sector opportunity items could not be matched to configured benchmark_symbols."
          : undefined,
        !riskGroups.length && forecast ? "matching forecast has no stored risk alert items." : undefined,
        ...benchmarks.filter((benchmark) => benchmark.error).map((benchmark) => `${benchmark.symbol}: ${benchmark.error}`),
      ].filter((warning): warning is string => Boolean(warning)),
    },
    usage_notes: [
      "This provider evaluates stored pre-market forecasts against benchmark close/latest snapshots.",
      "It is calibration telemetry, not a trading signal.",
      "stock_portfolio is included for the downstream post-market report when configured.",
    ],
  };

  return {
    text: payloadJson(payload),
    ...(portfolioResult?.attachments?.length ? { attachments: portfolioResult.attachments } : {}),
    commit: async () => {
      if (forecast && scores.length) {
        (deps.recordEvaluation ?? recordMarketForecastEvaluation)({
          forecastId: forecast.id,
          evaluatedAt: args.runAt.toISOString(),
          outcome: { benchmarks },
          score: {
            scores,
            score_groups: {
              index_direction: indexScores,
              sector_opportunity: sectorScores,
              risk_alert: riskScores,
            },
            calibration_note: note,
          },
          notes: note,
        });
      }
      await portfolioResult?.commit?.();
    },
  };
}

export const __testables = {
  probabilityGroups,
  outcomeBucket,
  indexEvaluationScores,
  sectorEvaluationScores,
  riskEvaluationScores,
  calibrationNote,
};
