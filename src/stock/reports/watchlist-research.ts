import type { PreProviderResult, PreProviderRunArgs } from "../../providers/types.js";
import type { ProviderContext, ProviderDryRunResult, ProviderManifest, ProviderModule } from "../../providers/framework.js";
import { providerDryRunFromError, providerHealthFromError, runProviderModuleAsPreProvider, safeProviderErrorMessage } from "../../providers/framework.js";
import { buildMarketIntelCalendarSnapshot } from "../data/calendar.js";
import { loadMarketIntelScoringCalibrationConfig } from "../../providers/market-intel/calibration.js";
import { collectMarketIntelOfficialEvidence } from "../data/market-evidence.js";
import { loadMarketIntelProviderConfig } from "../../providers/market-intel/config.js";
import { buildMarketIntelPayload } from "../../providers/market-intel/format.js";
import { buildNotConfiguredPortfolioContext } from "../data/market-portfolio.js";
import { collectMarketIntelMarketSnapshot } from "../data/quotes.js";
import { YahooMarketIntelQuoteClient } from "../sources/yahoo/market-intel-client.js";
import type { MarketIntelPayload, MarketIntelProviderConfig } from "../../providers/market-intel/types.js";
import { runStockPortfolioProvider } from "./stock-portfolio.js";
import { buildStockPulsePositionSnapshot } from "../signals/pulse.js";
import { loadStockPulseProviderConfig } from "../../providers/stock-pulse/config.js";
import { buildScanUniverse, extractPortfolioSymbols } from "../data/universe.js";
import { YahooStockPulseQuoteClient } from "../sources/yahoo/stock-pulse-client.js";
import type {
  StockPulseMarket,
  StockPulsePortfolioRunner,
  StockPulseProviderConfig,
  StockPulseQuoteClient,
  StockPulseQuoteConfig,
  StockPulseSymbol,
  StockPulseUniverseSourceConfig,
  StockPulseUniverseSymbol,
} from "../../providers/stock-pulse/types.js";
import { loadStockWatchlistResearchConfig } from "../../providers/stock-watchlist-research/config.js";
import { YahooStockWatchlistResearchClient } from "../sources/yahoo/watchlist-research-client.js";
import type {
  StockWatchlistNewsItem,
  StockWatchlistPortfolioFilterSummary,
  StockWatchlistResearchClient,
  StockWatchlistResearchConfig,
  StockWatchlistResearchPayload,
  StockWatchlistResearchSymbol,
} from "../../providers/stock-watchlist-research/types.js";

export interface StockWatchlistResearchProviderDeps {
  loadProviderConfig?: (name?: string) => StockWatchlistResearchConfig;
  loadStockPulseConfig?: (name?: string) => StockPulseProviderConfig;
  loadMarketIntelConfig?: (name?: string) => MarketIntelProviderConfig;
  quoteClient?: StockPulseQuoteClient;
  portfolioRunner?: StockPulsePortfolioRunner;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stockPulseSymbolKey(symbol: Pick<StockPulseSymbol, "market" | "yahoo_symbol">): string {
  return `${symbol.market}:${symbol.yahoo_symbol.toUpperCase()}`;
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

function positionRows(payload: Record<string, unknown>): Record<string, unknown>[] {
  const summary = isRecord(payload.positions_summary) ? payload.positions_summary : undefined;
  if (!summary) return [];
  return [
    ...(Array.isArray(summary.top_positions) ? summary.top_positions.filter(isRecord) : []),
    ...(Array.isArray(summary.top_gainers) ? summary.top_gainers.filter(isRecord) : []),
    ...(Array.isArray(summary.top_losers) ? summary.top_losers.filter(isRecord) : []),
    ...(Array.isArray(summary.position_premiums) ? summary.position_premiums.filter(isRecord) : []),
  ];
}

function portfolioCompletenessWarnings(portfolioPayload: unknown): string[] {
  if (!isRecord(portfolioPayload) || !Array.isArray(portfolioPayload.sources)) {
    return ["stock-portfolio payload has no source list; cannot safely exclude held symbols"];
  }
  const warnings: string[] = [];
  for (const source of portfolioPayload.sources.filter(isRecord)) {
    const sourceLabel = str(source.label) ?? `${str(source.provider) ?? "unknown"}/${str(source.config) ?? "default"}`;
    if (source.status !== "ok") {
      warnings.push(`portfolio source ${sourceLabel} is unavailable; cannot safely exclude held symbols`);
      continue;
    }
    const payload = isRecord(source.payload) ? source.payload : undefined;
    const summary = payload && isRecord(payload.positions_summary) ? payload.positions_summary : undefined;
    if (!payload || !summary) {
      warnings.push(`portfolio source ${sourceLabel} has no positions_summary; cannot safely exclude held symbols`);
      continue;
    }
    const positionsCount = num(summary.positions_count);
    if (positionsCount === undefined) {
      warnings.push(`portfolio source ${sourceLabel} has no positions_count; cannot safely exclude held symbols`);
      continue;
    }
    const availableCodes = new Set(positionRows(payload).map((row) => str(row.code)?.toUpperCase()).filter((code): code is string => Boolean(code)));
    if (availableCodes.size < positionsCount) {
      warnings.push(`portfolio source ${sourceLabel} only exposed ${availableCodes.size}/${positionsCount} held symbols; cannot safely exclude the full portfolio`);
    }
  }
  return warnings;
}

async function collectPortfolioFilter(params: {
  args: PreProviderRunArgs;
  stockPulseConfig: StockPulseProviderConfig;
  portfolioRunner: StockPulsePortfolioRunner;
  warnings: string[];
}): Promise<{ keys: Set<string>; summary: StockWatchlistPortfolioFilterSummary; skipReason?: string }> {
  const stockPortfolioConfig = params.stockPulseConfig.portfolio_provider_config;
  if (!stockPortfolioConfig) {
    return {
      keys: new Set(),
      summary: {
        status: "not_configured",
        held_symbols: 0,
        excluded_symbols: 0,
      },
      skipReason: "portfolio_filter_not_configured",
    };
  }
  try {
    const result = await params.portfolioRunner({
      ...params.args,
      configName: stockPortfolioConfig,
    });
    const payload = JSON.parse(result.text) as unknown;
    const symbols = extractPortfolioSymbols(payload, params.stockPulseConfig.market_scope);
    const completenessWarnings = portfolioCompletenessWarnings(payload);
    if (completenessWarnings.length) {
      params.warnings.push(...completenessWarnings);
      return {
        keys: new Set(symbols.map(stockPulseSymbolKey)),
        summary: {
          status: "incomplete",
          stock_portfolio_config: stockPortfolioConfig,
          held_symbols: symbols.length,
          excluded_symbols: 0,
        },
        skipReason: "portfolio_filter_incomplete",
      };
    }
    return {
      keys: new Set(symbols.map(stockPulseSymbolKey)),
      summary: {
        status: "applied",
        stock_portfolio_config: stockPortfolioConfig,
        held_symbols: symbols.length,
        excluded_symbols: 0,
      },
    };
  } catch (err) {
    params.warnings.push(`portfolio filter failed: ${safeProviderErrorMessage(err)}`);
    return {
      keys: new Set(),
      summary: {
        status: "failed",
        stock_portfolio_config: stockPortfolioConfig,
        held_symbols: 0,
        excluded_symbols: 0,
      },
      skipReason: "portfolio_filter_failed",
    };
  }
}

function notRunPortfolioFilter(stockPortfolioConfig: string | undefined): StockWatchlistPortfolioFilterSummary {
  return {
    status: "not_run",
    stock_portfolio_config: stockPortfolioConfig,
    held_symbols: 0,
    excluded_symbols: 0,
  };
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
  const portfolioRunner = deps.portfolioRunner ?? runStockPortfolioProvider;
  const researchClient = deps.researchClient ?? new YahooStockWatchlistResearchClient();
  const warnings: string[] = [];
  const watchlist = await collectBrokerWatchlistSymbols({ config, stockPulseConfig, quoteClient, warnings });
  let portfolioFilter = notRunPortfolioFilter(stockPulseConfig.portfolio_provider_config);
  let filteredWatchlistSymbols = watchlist.scanned;
  let skipReason: string | undefined;

  if (watchlist.scanned.length === 0) {
    skipReason = "empty_broker_watchlist";
  } else {
    const filter = await collectPortfolioFilter({
      args: {
        configName: profile,
        jobName: context.jobName,
        channelId: context.channelId,
        runAt: context.runAt,
      },
      stockPulseConfig,
      portfolioRunner,
      warnings,
    });
    filteredWatchlistSymbols = watchlist.scanned.filter((symbol) => !filter.keys.has(stockPulseSymbolKey(symbol)));
    portfolioFilter = {
      ...filter.summary,
      excluded_symbols: watchlist.scanned.length - filteredWatchlistSymbols.length,
    };
    skipReason = filter.skipReason;
    if (!skipReason && filteredWatchlistSymbols.length === 0) {
      skipReason = "empty_unowned_broker_watchlist";
    }
  }

  const symbols = skipReason ? [] : await mapLimit(filteredWatchlistSymbols, config.research.concurrency, async (symbol, index) => await enrichSymbol({
    symbol,
    index,
    config,
    stockPulseConfig,
    quoteClient,
    researchClient,
  }));
  const marketContext = skipReason ? undefined : await collectMarketContext({
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
  const skipped = Boolean(skipReason);
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
      skip_reason: skipReason,
    },
    watchlist_source: {
      stock_pulse_config: config.stock_pulse_config,
      enabled_broker_sources: watchlist.sources,
      fetched_symbols: watchlist.fetched.length,
      scanned_symbols: filteredWatchlistSymbols.length,
      raw_watchlist_symbols: watchlist.scanned.length,
      portfolio_filter: portfolioFilter,
      warnings,
    },
    symbols,
    market_context: marketContext,
    evidence: buildEvidence(symbols),
    warnings,
    usage_notes: [
      "This payload is watchlist-only. Symbols come from broker watchlist sources configured under stock-pulse universe sources and must not be treated as account holdings.",
      "Portfolio-held symbols are used only as an exclusion filter. The payload keeps only unowned watchlist symbols and does not emit excluded held symbols.",
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
