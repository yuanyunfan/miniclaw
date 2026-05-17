import type { PreProviderResult, PreProviderRunArgs } from "../../providers/types.js";
import { runStockPortfolioProvider } from "./stock-portfolio.js";
import { buildMarketIntelCalendarSnapshot } from "../data/calendar.js";
import { loadMarketIntelScoringCalibrationConfig } from "../../providers/market-intel/calibration.js";
import { buildEmptyMarketIntelEvidenceCollection, collectMarketIntelOfficialEvidence } from "../data/market-evidence.js";
import { loadMarketIntelProviderConfig } from "../../providers/market-intel/config.js";
import { buildMarketIntelPayload, formatMarketIntelPayload } from "../../providers/market-intel/format.js";
import { buildNotConfiguredPortfolioContext, collectMarketIntelPortfolio } from "../../providers/market-intel/portfolio.js";
import { buildEmptyMarketIntelSnapshot, collectMarketIntelMarketSnapshot } from "../data/quotes.js";
import { YahooMarketIntelQuoteClient } from "../sources/yahoo/market-intel-client.js";
import type {
  MarketIntelEvidenceCollector,
  MarketIntelQuoteClient,
  MarketIntelPortfolioRunner,
  MarketIntelProviderConfig,
} from "../../providers/market-intel/types.js";

export interface MarketIntelProviderDeps {
  loadProviderConfig?: (name?: string) => MarketIntelProviderConfig;
  portfolioRunner?: MarketIntelPortfolioRunner;
  quoteClient?: MarketIntelQuoteClient;
  evidenceCollector?: MarketIntelEvidenceCollector;
  loadCalibrationConfig?: typeof loadMarketIntelScoringCalibrationConfig;
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
  const evidenceCollection = skipReason
    ? buildEmptyMarketIntelEvidenceCollection()
    : await (deps.evidenceCollector ?? collectMarketIntelOfficialEvidence)({
      args,
      config,
    });
  const calibration = (deps.loadCalibrationConfig ?? loadMarketIntelScoringCalibrationConfig)();
  const payload = buildMarketIntelPayload({
    args,
    configName,
    config,
    calendar,
    portfolioContext: portfolio.context,
    marketSnapshot: marketSnapshot.snapshot,
    quoteEvidence: marketSnapshot.evidence,
    quoteWarnings: marketSnapshot.warnings,
    evidenceCollection,
    calibration,
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
