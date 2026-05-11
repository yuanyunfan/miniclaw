import type { PreProviderResult, PreProviderRunArgs } from "../types.js";
import { runStockPortfolioProvider } from "../stock-portfolio/index.js";
import { loadStockPulseProviderConfig } from "./config.js";
import { analyzeStockPulseSeries, buildStockPulsePositionSnapshot } from "./analyzer.js";
import { isActiveWindow, openMarketsAt } from "./market.js";
import { buildScanUniverse, extractPortfolioSymbols } from "./symbols.js";
import { YahooStockPulseQuoteClient } from "./yahoo-client.js";
import type {
  StockPulseAlert,
  StockPulsePayload,
  StockPulsePositionGroups,
  StockPulsePositionSnapshot,
  StockPulseQuoteFailure,
  StockPulsePortfolioRunner,
  StockPulseProviderConfig,
  StockPulseQuoteClient,
  StockPulseSymbol,
  StockPulseUniverseSymbol,
} from "./types.js";

export interface StockPulseProviderDeps {
  loadProviderConfig?: (name?: string) => StockPulseProviderConfig;
  portfolioRunner?: StockPulsePortfolioRunner;
  quoteClient?: StockPulseQuoteClient;
}

interface StockPulseQuoteResult {
  position?: StockPulsePositionSnapshot;
  alert?: StockPulseAlert;
  failure?: StockPulseQuoteFailure;
}

function sanitizeStockPulseError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/(validatekey=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/(password|token|cookie|secret|session|account|customer|acc_id)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
    .replace(/([A-Za-z0-9+/=_-]{24,})/g, "[redacted]")
    .slice(0, 800);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index;
      const current = items[index];
      index += 1;
      if (current !== undefined) out[currentIndex] = await fn(current);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return out;
}

async function collectPortfolioSymbols(params: {
  args: PreProviderRunArgs;
  config: StockPulseProviderConfig;
  portfolioRunner: StockPulsePortfolioRunner;
  commits: Array<() => Promise<void>>;
  warnings: string[];
}): Promise<StockPulseSymbol[]> {
  if (!params.config.universe.include_portfolio || !params.config.portfolio_provider_config) return [];
  try {
    const result = await params.portfolioRunner({
      ...params.args,
      configName: params.config.portfolio_provider_config,
    });
    if (result.commit) params.commits.push(result.commit);
    return extractPortfolioSymbols(JSON.parse(result.text) as unknown, params.config.market_scope);
  } catch (err) {
    params.warnings.push(`portfolio source failed: ${sanitizeStockPulseError(err)}`);
    return [];
  }
}

async function collectUniverseSourceSymbols(
  config: StockPulseProviderConfig,
  quoteClient: StockPulseQuoteClient,
  warnings: string[],
): Promise<StockPulseUniverseSymbol[]> {
  if (!config.universe.include_sources || !quoteClient.getUniverseSymbols) return [];
  const symbols: StockPulseUniverseSymbol[] = [];
  for (const source of config.universe.sources) {
    try {
      symbols.push(...await quoteClient.getUniverseSymbols(source));
    } catch (err) {
      warnings.push(`universe source ${source.name} failed: ${sanitizeStockPulseError(err)}`);
    }
  }
  return symbols;
}

function marketTimezone(config: StockPulseProviderConfig, symbol: StockPulseSymbol): string {
  return config.markets[symbol.market]?.timezone ?? "Asia/Shanghai";
}

function dailyPnlCny(position: StockPulsePositionSnapshot): number | undefined {
  const value = position.portfolio?.daily_pnl_cny;
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function sortBySymbol(a: StockPulsePositionSnapshot, b: StockPulsePositionSnapshot): number {
  return a.symbol.localeCompare(b.symbol);
}

function buildPositionGroups(positions: StockPulsePositionSnapshot[]): StockPulsePositionGroups {
  const profitable = positions
    .filter((position) => (dailyPnlCny(position) ?? 0) > 0)
    .sort((a, b) => (dailyPnlCny(b) ?? 0) - (dailyPnlCny(a) ?? 0) || sortBySymbol(a, b));
  const losing = positions
    .filter((position) => (dailyPnlCny(position) ?? 0) < 0)
    .sort((a, b) => (dailyPnlCny(a) ?? 0) - (dailyPnlCny(b) ?? 0) || sortBySymbol(a, b));
  const flatOrUnknown = positions
    .filter((position) => {
      const value = dailyPnlCny(position);
      return value === undefined || value === 0;
    })
    .sort(sortBySymbol);
  return { profitable, losing, flat_or_unknown: flatOrUnknown };
}

function buildPayload(params: {
  args: PreProviderRunArgs;
  config: StockPulseProviderConfig;
  activeWindowOk: boolean;
  openMarkets: StockPulsePayload["run_context"]["open_markets"];
  skipReason?: string;
  configuredSymbols: number;
  portfolioSymbols: number;
  universeSourceSymbols: number;
  scannedSymbols: number;
  failedSymbols: number;
  positions: StockPulsePositionSnapshot[];
  alerts: StockPulseAlert[];
  failures: StockPulseQuoteFailure[];
  warnings: string[];
}): StockPulsePayload {
  return {
    generated_at: params.args.runAt.toISOString(),
    source: "stock-pulse",
    profile: params.args.configName ?? "default",
    market_scope: params.config.market_scope,
    run_context: {
      active_window_ok: params.activeWindowOk,
      open_markets: params.openMarkets,
      skipped: Boolean(params.skipReason),
      skip_reason: params.skipReason,
    },
    universe: {
      configured_symbols: params.configuredSymbols,
      portfolio_symbols: params.portfolioSymbols,
      universe_source_symbols: params.universeSourceSymbols,
      scanned_symbols: params.scannedSymbols,
      failed_symbols: params.failedSymbols,
    },
    positions: params.positions.sort(sortBySymbol),
    position_groups: buildPositionGroups(params.positions),
    alerts: params.alerts.sort((a, b) => {
      const severity = { urgent: 3, alert: 2, notice: 1 };
      return severity[b.severity] - severity[a.severity] || (b.z_score ?? 0) - (a.z_score ?? 0);
    }),
    failures: params.failures.sort((a, b) => a.symbol.localeCompare(b.symbol)),
    warnings: params.warnings,
    usage_notes: [
      "This payload is generated by MiniClaw stock-pulse. It scans portfolio/watchlist/universe symbols only when both the user's active window and a configured market session are open.",
      "Use positions[] for the current intraday holding snapshot, including latest price, return metrics, and CNY P&L when portfolio data provides it.",
      "Alerts are deterministic: fixed return floors plus rolling intraday volatility, abnormal 5m-bar frequency, one-way bars, and z-score checks.",
      "Use alerts[] as the only anomaly list. If alerts is empty, say no abnormal move was detected; do not invent movers.",
      "This is analysis-only output. Do not provide trade instructions unless explicitly asked.",
    ],
  };
}

export async function runStockPulseProvider(
  args: PreProviderRunArgs,
  deps: StockPulseProviderDeps = {},
): Promise<PreProviderResult> {
  const configName = args.configName ?? "default";
  const config = (deps.loadProviderConfig ?? loadStockPulseProviderConfig)(configName);
  const quoteClient = deps.quoteClient ?? new YahooStockPulseQuoteClient();
  const portfolioRunner = deps.portfolioRunner ?? runStockPortfolioProvider;
  const warnings: string[] = [];
  const commits: Array<() => Promise<void>> = [];

  const activeWindowOk = isActiveWindow(args.runAt, config.active_window);
  const openMarkets = openMarketsAt(args.runAt, config.markets);
  if (!activeWindowOk || openMarkets.length === 0) {
    const payload = buildPayload({
      args,
      config,
      activeWindowOk,
      openMarkets,
      skipReason: !activeWindowOk ? "outside_user_active_window" : "no_configured_market_open",
      configuredSymbols: config.universe.symbols.length,
      portfolioSymbols: 0,
      universeSourceSymbols: 0,
      scannedSymbols: 0,
      failedSymbols: 0,
      positions: [],
      alerts: [],
      failures: [],
      warnings,
    });
    return { text: JSON.stringify(payload, null, 2) };
  }

  if (!config.universe.enabled) {
    const payload = buildPayload({
      args,
      config,
      activeWindowOk,
      openMarkets,
      skipReason: "universe_disabled",
      configuredSymbols: config.universe.symbols.length,
      portfolioSymbols: 0,
      universeSourceSymbols: 0,
      scannedSymbols: 0,
      failedSymbols: 0,
      positions: [],
      alerts: [],
      failures: [],
      warnings,
    });
    return { text: JSON.stringify(payload, null, 2) };
  }

  const portfolioSymbols = await collectPortfolioSymbols({
    args,
    config,
    portfolioRunner,
    commits,
    warnings,
  });
  const universeSourceSymbols = await collectUniverseSourceSymbols(config, quoteClient, warnings);
  const symbols = buildScanUniverse({
    scope: config.market_scope,
    configured: config.universe.symbols,
    portfolio: portfolioSymbols,
    universeSourceSymbols,
    includeWatchlist: config.universe.include_watchlist,
    includePortfolio: config.universe.include_portfolio,
    includeSources: config.universe.include_sources,
    openMarkets,
    maxSymbols: config.universe.max_symbols,
  });

  const quoteResults = await mapLimit(symbols, config.quote.concurrency, async (symbol): Promise<StockPulseQuoteResult> => {
    try {
      const series = await quoteClient.getBars(symbol, config.quote);
      const marketTimezoneValue = marketTimezone(config, symbol);
      const position = buildStockPulsePositionSnapshot({
        symbol,
        series,
        marketTimezone: marketTimezoneValue,
      });
      const alert = analyzeStockPulseSeries({
        symbol,
        series,
        thresholds: config.thresholds,
        marketTimezone: marketTimezoneValue,
      });
      return { position, alert };
    } catch (err) {
      const error = sanitizeStockPulseError(err);
      warnings.push(`${symbol.yahoo_symbol}: ${error}`);
      return {
        failure: {
          symbol: symbol.symbol,
          yahoo_symbol: symbol.yahoo_symbol,
          name: symbol.name,
          market: symbol.market,
          sources: symbol.sources,
          error,
        },
      };
    }
  });
  const positions = quoteResults
    .map((result) => result.position)
    .filter((position): position is StockPulsePositionSnapshot => position !== undefined);
  const failures = quoteResults
    .map((result) => result.failure)
    .filter((failure): failure is StockPulseQuoteFailure => failure !== undefined);
  const alerts = quoteResults
    .map((result) => result.alert)
    .filter((alert): alert is StockPulseAlert => alert !== undefined);

  const payload = buildPayload({
    args,
    config,
    activeWindowOk,
    openMarkets,
    configuredSymbols: config.universe.symbols.length,
    portfolioSymbols: portfolioSymbols.length,
    universeSourceSymbols: universeSourceSymbols.length,
    scannedSymbols: symbols.length,
    failedSymbols: failures.length,
    positions,
    alerts,
    failures,
    warnings,
  });

  return {
    text: JSON.stringify(payload, null, 2),
    commit: commits.length
      ? async () => {
        for (const commit of commits) await commit();
      }
      : undefined,
  };
}
