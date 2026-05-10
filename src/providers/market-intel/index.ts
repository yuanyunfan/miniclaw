import type { PreProviderResult, PreProviderRunArgs } from "../types.js";
import { runStockPortfolioProvider } from "../stock-portfolio/index.js";
import { buildMarketIntelCalendarSnapshot } from "./calendar.js";
import { loadMarketIntelProviderConfig } from "./config.js";
import { buildMarketIntelPayload, formatMarketIntelPayload } from "./format.js";
import { buildNotConfiguredPortfolioContext, collectMarketIntelPortfolio } from "./portfolio.js";
import { buildEmptyMarketIntelSnapshot, collectMarketIntelMarketSnapshot, YahooMarketIntelQuoteClient } from "./quotes.js";
import type { MarketIntelQuoteClient, MarketIntelPortfolioRunner, MarketIntelProviderConfig } from "./types.js";

export interface MarketIntelProviderDeps {
  loadProviderConfig?: (name?: string) => MarketIntelProviderConfig;
  portfolioRunner?: MarketIntelPortfolioRunner;
  quoteClient?: MarketIntelQuoteClient;
}

export async function runMarketIntelProvider(
  args: PreProviderRunArgs,
  deps: MarketIntelProviderDeps = {},
): Promise<PreProviderResult> {
  const configName = args.configName ?? "default";
  const config = (deps.loadProviderConfig ?? loadMarketIntelProviderConfig)(configName);
  const calendar = buildMarketIntelCalendarSnapshot({
    date: args.runAt,
    timezone: config.timezone,
    markets: config.markets,
  });
  const skipReason = calendar.status === "closed" && config.calendar.skip_closed_market ? "market_closed" : undefined;
  const portfolio = skipReason
    ? { context: buildNotConfiguredPortfolioContext() }
    : await collectMarketIntelPortfolio({
      args,
      config,
      runner: deps.portfolioRunner ?? runStockPortfolioProvider,
    });
  const marketSnapshot = skipReason
    ? {
      snapshot: buildEmptyMarketIntelSnapshot(),
      evidence: [],
      warnings: [],
    }
    : await collectMarketIntelMarketSnapshot({
      args,
      config,
      client: deps.quoteClient ?? new YahooMarketIntelQuoteClient(),
    });
  const payload = buildMarketIntelPayload({
    args,
    configName,
    config,
    calendar,
    portfolioContext: portfolio.context,
    marketSnapshot: marketSnapshot.snapshot,
    quoteEvidence: marketSnapshot.evidence,
    quoteWarnings: marketSnapshot.warnings,
    skipReason,
  });
  const text = formatMarketIntelPayload(payload);
  if (skipReason) {
    return {
      text,
      skipTask: {
        reason: skipReason,
        message: `market-intel skipped ${configName}: all configured markets are closed for ${calendar.trade_date}`,
      },
    };
  }
  return {
    text,
    commit: portfolio.commit,
  };
}
