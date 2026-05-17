import type { PreProviderResult, PreProviderRunArgs } from "../../providers/types.js";
import { runStockPortfolioProvider } from "./stock-portfolio.js";
import { zonedDateKey } from "../data/calendar.js";
import { sanitizeMarketIntelError } from "../../providers/market-intel/format.js";
import { YahooMarketIntelQuoteClient } from "../sources/yahoo/market-intel-client.js";
import {
  findLatestMarketForecast,
  listMarketForecastItems,
  recordMarketForecastEvaluation,
} from "../../store/market-forecasts.js";
import { loadMarketForecastEvaluationProviderConfig } from "../../providers/market-forecast-evaluation/config.js";
import type {
  MarketForecastBenchmarkConfig,
  MarketForecastBenchmarkResult,
  MarketForecastEvaluationPortfolioRunner,
  MarketForecastEvaluationProviderConfig,
  MarketForecastEvaluationQuoteClient,
  MarketForecastEvaluationQuoteInput,
} from "../../providers/market-forecast-evaluation/types.js";
import {
  calibrationNote,
  changePct,
  indexEvaluationScores,
  isHorizonOnlyForecast,
  outcomeBucket,
  probabilityGroups,
  riskEvaluationScores,
  sectorEvaluationScores,
} from "../signals/forecast-evaluation.js";

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
  const horizonOnly = isHorizonOnlyForecast(items);
  const groups = horizonOnly ? [] : probabilityGroups(items, "index_probability");
  const sectorGroups = horizonOnly ? [] : probabilityGroups(items, "sector_opportunity");
  const riskGroups = horizonOnly ? [] : probabilityGroups(items, "risk_alert");
  const benchmarks = await benchmarkResults({ config, quoteClient });
  const indexScores = indexEvaluationScores(groups, benchmarks);
  const sectorScores = sectorEvaluationScores(sectorGroups, benchmarks);
  const riskScores = riskEvaluationScores(riskGroups, benchmarks);
  const scores = [...indexScores, ...sectorScores, ...riskScores];
  const note = horizonOnly
    ? "Stored pre-market forecast is medium/long horizon only; same-day post-market hit/miss and Brier calibration are intentionally skipped."
    : calibrationNote(scores, benchmarks);
  const status = !forecast
    ? "no_forecast"
    : horizonOnly
      ? "horizon_only"
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
        horizonOnly ? "matching forecast contains only medium/long horizon items; same-day calibration is skipped by design." : undefined,
        !groups.length && forecast && !horizonOnly ? "matching forecast has no stored index probability items." : undefined,
        !sectorGroups.length && forecast && !horizonOnly ? "matching forecast has no stored sector opportunity items." : undefined,
        sectorScores.some((score) => score.benchmark_symbol === "unmapped_sector_benchmark")
          ? "some sector opportunity items could not be matched to configured benchmark_symbols."
          : undefined,
        !riskGroups.length && forecast && !horizonOnly ? "matching forecast has no stored risk alert items." : undefined,
        ...benchmarks.filter((benchmark) => benchmark.error).map((benchmark) => `${benchmark.symbol}: ${benchmark.error}`),
      ].filter((warning): warning is string => Boolean(warning)),
    },
    usage_notes: [
      "This provider evaluates stored pre-market forecasts against benchmark close/latest snapshots.",
      "Medium/long horizon forecasts are tracked but not scored against the same-day post-market benchmark.",
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
