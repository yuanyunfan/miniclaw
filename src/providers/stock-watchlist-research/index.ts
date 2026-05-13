import type { PreProviderResult, PreProviderRunArgs } from "../types.js";
import type { ProviderContext, ProviderDryRunResult, ProviderManifest, ProviderModule } from "../framework.js";
import { providerDryRunFromError, providerHealthFromError, runProviderModuleAsPreProvider, safeProviderErrorMessage } from "../framework.js";
import { buildMarketIntelCalendarSnapshot } from "../market-intel/calendar.js";
import { loadMarketIntelScoringCalibrationConfig } from "../market-intel/calibration.js";
import { collectMarketIntelOfficialEvidence } from "../market-intel/collectors/official.js";
import { loadMarketIntelProviderConfig } from "../market-intel/config.js";
import { buildMarketIntelPayload } from "../market-intel/format.js";
import { buildNotConfiguredPortfolioContext } from "../market-intel/portfolio.js";
import { collectMarketIntelMarketSnapshot, YahooMarketIntelQuoteClient } from "../market-intel/quotes.js";
import type { MarketIntelPayload, MarketIntelProviderConfig } from "../market-intel/types.js";
import { buildStockPulsePositionSnapshot } from "../stock-pulse/analyzer.js";
import { loadStockPulseProviderConfig } from "../stock-pulse/config.js";
import { buildScanUniverse } from "../stock-pulse/symbols.js";
import { YahooStockPulseQuoteClient } from "../stock-pulse/yahoo-client.js";
import type {
  StockPulseMarket,
  StockPulseProviderConfig,
  StockPulseQuoteClient,
  StockPulseQuoteConfig,
  StockPulseSymbol,
  StockPulseUniverseSourceConfig,
  StockPulseUniverseSymbol,
} from "../stock-pulse/types.js";
import { loadStockWatchlistResearchConfig } from "./config.js";
import { YahooStockWatchlistResearchClient } from "./research-client.js";
import type {
  StockWatchlistNewsItem,
  StockWatchlistResearchClient,
  StockWatchlistResearchConfig,
  StockWatchlistResearchPayload,
  StockWatchlistResearchSymbol,
} from "./types.js";

export interface StockWatchlistResearchProviderDeps {
  loadProviderConfig?: (name?: string) => StockWatchlistResearchConfig;
  loadStockPulseConfig?: (name?: string) => StockPulseProviderConfig;
  loadMarketIntelConfig?: (name?: string) => MarketIntelProviderConfig;
  quoteClient?: StockPulseQuoteClient;
  researchClient?: StockWatchlistResearchClient;
}

export const stockWatchlistResearchProviderManifest: ProviderManifest = {
  name: "stock-watchlist-research",
  kind: "stock",
  privacy: "private",
  sideEffects: "none",
  supportsDryRun: true,
  supportsHealthCheck: true,
  outputSchemaVersion: "stock-watchlist-research.payload.v1",
};

function brokerWatchlistSource(source: StockPulseUniverseSourceConfig): boolean {
  return source.type === "futu_watchlist" || source.type === "eastmoney_myfavor_watchlist";
}

function marketsForScope(scope: StockWatchlistResearchConfig["market_scope"]): StockPulseMarket[] {
  return scope === "us" ? ["us"] : ["cn-a", "hk"];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index;
      const current = items[index];
      index += 1;
      if (current !== undefined) out[currentIndex] = await fn(current, currentIndex);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return out;
}

async function collectBrokerWatchlistSymbols(params: {
  config: StockWatchlistResearchConfig;
  stockPulseConfig: StockPulseProviderConfig;
  quoteClient: StockPulseQuoteClient;
  warnings: string[];
}): Promise<{ sources: number; fetched: StockPulseUniverseSymbol[]; scanned: StockPulseSymbol[] }> {
  const sources = params.stockPulseConfig.universe.sources.filter((source) => source.enabled !== false && brokerWatchlistSource(source));
  const fetched: StockPulseUniverseSymbol[] = [];
  for (const source of sources) {
    if (!params.quoteClient.getUniverseSymbols) {
      params.warnings.push(`watchlist source ${source.name} skipped: quote client does not support universe sources`);
      continue;
    }
    try {
      fetched.push(...await params.quoteClient.getUniverseSymbols(source));
    } catch (err) {
      params.warnings.push(`watchlist source ${source.name} failed: ${safeProviderErrorMessage(err)}`);
    }
  }
  const scanned = buildScanUniverse({
    scope: params.config.market_scope,
    configured: [],
    portfolio: [],
    universeSourceSymbols: fetched,
    includeWatchlist: false,
    includePortfolio: false,
    includeSources: true,
    openMarkets: marketsForScope(params.config.market_scope),
    maxSymbols: params.config.max_symbols,
  });
  return { sources: sources.length, fetched, scanned };
}

function quoteConfig(config: StockWatchlistResearchConfig): StockPulseQuoteConfig {
  return {
    provider: "yahoo",
    interval: config.quote.interval,
    range: config.quote.range,
    include_prepost: config.quote.include_prepost,
    timeout_ms: config.quote.timeout_ms,
    concurrency: config.quote.concurrency,
  };
}

function marketTimezone(stockPulseConfig: StockPulseProviderConfig, symbol: StockPulseSymbol): string {
  return stockPulseConfig.markets[symbol.market]?.timezone ?? "Asia/Shanghai";
}

function latestNewsEvidenceId(symbolIndex: number, newsIndex: number): string {
  return `watchlist.news.${symbolIndex + 1}.${newsIndex + 1}`;
}

function compactNewsSummary(news: StockWatchlistNewsItem): string {
  return `${news.publisher ? `${news.publisher}: ` : ""}${news.title}`;
}

async function enrichSymbol(params: {
  symbol: StockPulseSymbol;
  index: number;
  config: StockWatchlistResearchConfig;
  stockPulseConfig: StockPulseProviderConfig;
  quoteClient: StockPulseQuoteClient;
  researchClient: StockWatchlistResearchClient;
}): Promise<StockWatchlistResearchSymbol> {
  const evidenceIds: string[] = [];
  const out: StockWatchlistResearchSymbol = {
    symbol: params.symbol.symbol,
    yahoo_symbol: params.symbol.yahoo_symbol,
    name: params.symbol.name,
    market: params.symbol.market,
    instrument_type: params.symbol.instrument_type,
    sources: params.symbol.sources,
    evidence_ids: evidenceIds,
    news: [],
  };
  try {
    const series = await params.quoteClient.getBars(params.symbol, quoteConfig(params.config));
    const quote = buildStockPulsePositionSnapshot({
      symbol: params.symbol,
      series,
      marketTimezone: marketTimezone(params.stockPulseConfig, params.symbol),
    });
    if (quote) {
      out.quote = quote;
      evidenceIds.push(`watchlist.quote.${params.index + 1}`);
    }
  } catch (err) {
    out.quote_error = safeProviderErrorMessage(err);
  }

  if (!params.config.research.enabled) return out;

  const [profileResult, financialsResult, newsResult] = await Promise.allSettled([
    params.researchClient.getProfile(params.symbol, params.config.research.timeout_ms),
    params.researchClient.getFinancials(params.symbol, params.config.research.timeout_ms),
    params.researchClient.getNews(params.symbol, params.config.research.news_count_per_symbol, params.config.research.timeout_ms),
  ]);
  if (profileResult.status === "fulfilled" && profileResult.value) {
    out.profile = profileResult.value;
    evidenceIds.push(`watchlist.profile.${params.index + 1}`);
  } else if (profileResult.status === "rejected") {
    out.profile_error = safeProviderErrorMessage(profileResult.reason);
  }
  if (financialsResult.status === "fulfilled") {
    out.financials = financialsResult.value;
    if (financialsResult.value.latest_points.length) evidenceIds.push(`watchlist.financials.${params.index + 1}`);
  } else {
    out.financials = {
      source: "yahoo_finance_fundamentals_timeseries",
      status: "failed",
      latest_points: [],
      error: safeProviderErrorMessage(financialsResult.reason),
    };
  }
  if (newsResult.status === "fulfilled") {
    out.news = newsResult.value;
    out.news.forEach((_item, newsIndex) => evidenceIds.push(latestNewsEvidenceId(params.index, newsIndex)));
  } else {
    out.news_error = safeProviderErrorMessage(newsResult.reason);
  }
  return out;
}

function cloneMarketIntelConfig(params: {
  config: StockWatchlistResearchConfig;
  marketConfig: MarketIntelProviderConfig;
  symbols: StockPulseSymbol[];
}): MarketIntelProviderConfig {
  return {
    ...params.marketConfig,
    market_scope: params.config.market_scope,
    portfolio_provider_config: undefined,
    watchlists: {
      ...params.marketConfig.watchlists,
      symbols: params.symbols.map((symbol) => symbol.yahoo_symbol),
    },
  };
}

async function collectMarketContext(params: {
  args: PreProviderRunArgs;
  config: StockWatchlistResearchConfig;
  symbols: StockPulseSymbol[];
  loadMarketIntelConfig: (name?: string) => MarketIntelProviderConfig;
}): Promise<MarketIntelPayload | undefined> {
  if (!params.config.market_intel_config) return undefined;
  const marketConfig = cloneMarketIntelConfig({
    config: params.config,
    marketConfig: params.loadMarketIntelConfig(params.config.market_intel_config),
    symbols: params.symbols,
  });
  const calendar = buildMarketIntelCalendarSnapshot({
    date: params.args.runAt,
    timezone: marketConfig.timezone,
    markets: marketConfig.markets,
  });
  const marketSnapshot = await collectMarketIntelMarketSnapshot({
    args: params.args,
    config: marketConfig,
    client: new YahooMarketIntelQuoteClient(),
  });
  const evidenceCollection = await collectMarketIntelOfficialEvidence({
    args: params.args,
    config: marketConfig,
  });
  return buildMarketIntelPayload({
    args: params.args,
    configName: params.config.market_intel_config,
    config: marketConfig,
    calendar,
    portfolioContext: buildNotConfiguredPortfolioContext(),
    marketSnapshot: marketSnapshot.snapshot,
    quoteEvidence: marketSnapshot.evidence,
    quoteWarnings: marketSnapshot.warnings,
    evidenceCollection,
    calibration: loadMarketIntelScoringCalibrationConfig(),
  });
}

function buildEvidence(symbols: StockWatchlistResearchSymbol[]): StockWatchlistResearchPayload["evidence"] {
  return symbols.flatMap((symbol, symbolIndex) => {
    const items: StockWatchlistResearchPayload["evidence"] = [];
    if (symbol.quote) {
      items.push({
        id: `watchlist.quote.${symbolIndex + 1}`,
        category: "quote",
        symbol: symbol.symbol,
        source: "yahoo_chart_unofficial",
        summary: `${symbol.symbol} quote snapshot: latest_at=${symbol.quote.latest_at}; day_return_pct=${symbol.quote.day_return_pct ?? "unknown"}; hour_return_pct=${symbol.quote.hour_return_pct ?? "unknown"}.`,
      });
    }
    if (symbol.profile) {
      items.push({
        id: `watchlist.profile.${symbolIndex + 1}`,
        category: "profile",
        symbol: symbol.symbol,
        source: symbol.profile.source,
        summary: `${symbol.symbol} profile: sector=${symbol.profile.sector ?? "unknown"}; industry=${symbol.profile.industry ?? "unknown"}; exchange=${symbol.profile.exchange ?? "unknown"}.`,
      });
    }
    if (symbol.financials?.latest_points.length) {
      items.push({
        id: `watchlist.financials.${symbolIndex + 1}`,
        category: "financials",
        symbol: symbol.symbol,
        source: symbol.financials.source,
        summary: `${symbol.symbol} fundamentals points: ${symbol.financials.latest_points.map((point) => `${point.type}=${point.fmt ?? point.raw ?? "unknown"}${point.as_of_date ? ` as_of=${point.as_of_date}` : ""}`).join("; ")}.`,
      });
    }
    symbol.news.forEach((news, newsIndex) => {
      items.push({
        id: latestNewsEvidenceId(symbolIndex, newsIndex),
        category: "news",
        symbol: symbol.symbol,
        source: "yahoo_finance_search",
        summary: compactNewsSummary(news),
        url: news.url,
        published_at: news.published_at,
      });
    });
    return items;
  });
}

async function runStockWatchlistResearchStructured(
  context: ProviderContext,
  deps: StockWatchlistResearchProviderDeps = {},
): Promise<StockWatchlistResearchPayload> {
  const profile = context.configName ?? "default";
  const config = (deps.loadProviderConfig ?? loadStockWatchlistResearchConfig)(profile);
  const stockPulseConfig = (deps.loadStockPulseConfig ?? loadStockPulseProviderConfig)(config.stock_pulse_config);
  const quoteClient = deps.quoteClient ?? new YahooStockPulseQuoteClient();
  const researchClient = deps.researchClient ?? new YahooStockWatchlistResearchClient();
  const warnings: string[] = [];
  const watchlist = await collectBrokerWatchlistSymbols({ config, stockPulseConfig, quoteClient, warnings });

  const symbols = await mapLimit(watchlist.scanned, config.research.concurrency, async (symbol, index) => await enrichSymbol({
    symbol,
    index,
    config,
    stockPulseConfig,
    quoteClient,
    researchClient,
  }));
  const marketContext = await collectMarketContext({
    args: {
      configName: profile,
      jobName: context.jobName,
      channelId: context.channelId,
      runAt: context.runAt,
    },
    config,
    symbols: watchlist.scanned,
    loadMarketIntelConfig: deps.loadMarketIntelConfig ?? loadMarketIntelProviderConfig,
  }).catch((err: unknown) => {
    warnings.push(`market-intel context failed: ${safeProviderErrorMessage(err)}`);
    return undefined;
  });
  const skipped = watchlist.scanned.length === 0;
  return {
    generated_at: context.runAt.toISOString(),
    source: "stock-watchlist-research",
    profile,
    market_scope: config.market_scope,
    run_type: config.run_type,
    run_context: {
      job_name: context.jobName,
      channel_id: context.channelId,
      timezone: config.timezone,
      watchlist_only: true,
      skipped,
      skip_reason: skipped ? "empty_broker_watchlist" : undefined,
    },
    watchlist_source: {
      stock_pulse_config: config.stock_pulse_config,
      enabled_broker_sources: watchlist.sources,
      fetched_symbols: watchlist.fetched.length,
      scanned_symbols: watchlist.scanned.length,
      warnings,
    },
    symbols,
    market_context: marketContext,
    evidence: buildEvidence(symbols),
    warnings,
    usage_notes: [
      "This payload is watchlist-only. Symbols come from broker watchlist sources configured under stock-pulse universe sources and must not be treated as account holdings.",
      "Use quote/profile/financials/news evidence IDs for company-level claims; use market_context evidence IDs for broad-market, macro, filing, and announcement claims.",
      "The downstream report must produce a buy-timing conclusion for each symbol using a constrained label: worth_small_starter, wait_for_pullback, not_buyable_now, or watch_only.",
      "This is research and risk monitoring only. Do not output automatic trading instructions, order sizes, broker actions, raw account IDs, token, cookie, validatekey, or session data.",
    ],
  };
}

export const stockWatchlistResearchProvider: ProviderModule<StockWatchlistResearchPayload> = {
  manifest: stockWatchlistResearchProviderManifest,
  async healthCheck(context) {
    try {
      const config = loadStockWatchlistResearchConfig(context.configName ?? "default");
      loadStockPulseProviderConfig(config.stock_pulse_config);
      if (config.market_intel_config) loadMarketIntelProviderConfig(config.market_intel_config);
      return {
        ok: true,
        message: `stock-watchlist-research config ok: ${context.configName ?? "default"}`,
        checkedAt: new Date().toISOString(),
        safeDetails: {
          market_scope: config.market_scope,
          run_type: config.run_type,
          stock_pulse_config: config.stock_pulse_config,
          market_intel_config: config.market_intel_config,
          max_symbols: config.max_symbols,
        },
      };
    } catch (err) {
      return providerHealthFromError(err);
    }
  },
  async dryRun(context): Promise<ProviderDryRunResult<StockWatchlistResearchPayload>> {
    try {
      const structured = await runStockWatchlistResearchStructured(context);
      return {
        ok: !structured.run_context.skipped,
        category: structured.run_context.skipped ? "data_absence" : undefined,
        structured,
        previewText: `watchlist symbols=${structured.symbols.length}; evidence=${structured.evidence.length}; warnings=${structured.warnings.length}`,
        redacted: true,
        warnings: structured.warnings,
      };
    } catch (err) {
      return providerDryRunFromError(err);
    }
  },
  async run(context) {
    return await runStockWatchlistResearchStructured(context);
  },
  async format(result): Promise<PreProviderResult> {
    const text = JSON.stringify(result, null, 2);
    if (result.run_context.skipped) {
      return {
        text,
        skipTask: {
          reason: result.run_context.skip_reason ?? "stock_watchlist_research_skipped",
          message: `stock-watchlist-research skipped: ${result.run_context.skip_reason ?? "unknown"}`,
          notifyMessage: `⏰ stock-watchlist-research skipped: ${result.run_context.skip_reason ?? "unknown"}`,
        },
      };
    }
    return { text };
  },
};

export async function runStockWatchlistResearchProvider(
  args: PreProviderRunArgs,
  deps: StockWatchlistResearchProviderDeps = {},
): Promise<PreProviderResult> {
  if (Object.keys(deps).length === 0) {
    return await runProviderModuleAsPreProvider(stockWatchlistResearchProvider, args);
  }
  const context: ProviderContext = {
    configName: args.configName,
    jobName: args.jobName,
    channelId: args.channelId,
    runAt: args.runAt,
  };
  const structured = await runStockWatchlistResearchStructured(context, deps);
  return await stockWatchlistResearchProvider.format(structured, context);
}

export const __testables = {
  collectBrokerWatchlistSymbols,
  buildEvidence,
  cloneMarketIntelConfig,
};
