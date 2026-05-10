import type {
  MarketIntelCalendarSnapshot,
  MarketIntelDataQuality,
  MarketIntelDataQualitySource,
  MarketIntelEvidenceItem,
  MarketIntelMarketSnapshot,
  MarketIntelPayload,
  MarketIntelPlaceholderSection,
  MarketIntelPortfolioContext,
  MarketIntelProviderConfig,
  MarketIntelRoleProtocol,
} from "./types.js";
import { buildMarketIntelScores } from "./scoring.js";
import type { PreProviderRunArgs } from "../types.js";
import { buildNotConfiguredPortfolioContext } from "./portfolio.js";
import { sanitizeMarketIntelError } from "./redaction.js";

export { sanitizeMarketIntelError };

function redactJsonStringValues(value: unknown): unknown {
  if (typeof value === "string") return sanitizeMarketIntelError(value);
  if (Array.isArray(value)) return value.map(redactJsonStringValues);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactJsonStringValues(item)]),
  );
}

function placeholder(notes: string[]): MarketIntelPlaceholderSection {
  return {
    status: "not_implemented",
    items: [],
    notes,
  };
}

export function buildMarketIntelMarketSnapshot(config: MarketIntelProviderConfig): MarketIntelMarketSnapshot {
  return {
    indices: placeholder([
      `Index watchlist configured: ${config.watchlists.indices.join(", ") || "none"}. Quote collector is not implemented in phase 1.`,
    ]),
    sectors: placeholder([
      `Sector watchlist configured: ${config.watchlists.sectors.join(", ") || "none"}. Sector collector is not implemented in phase 1.`,
    ]),
    macro: placeholder([
      `Macro watchlist configured: ${config.watchlists.macro.join(", ") || "none"}. Macro snapshot collector is not implemented in phase 1.`,
    ]),
    cross_market: placeholder([
      `Cross-market watchlist configured: ${config.watchlists.cross_market.join(", ") || "none"}. Cross-market collector is not implemented in phase 1.`,
    ]),
  };
}

function buildSourceQuality(
  config: MarketIntelProviderConfig,
  calendar: MarketIntelCalendarSnapshot,
  portfolioContext: MarketIntelPortfolioContext,
): MarketIntelDataQualitySource[] {
  const quoteSources = [
    config.sources.quotes.us_primary,
    config.sources.quotes.hk_primary,
    config.sources.quotes.cn_a_primary,
    ...config.sources.quotes.fallback,
    ...config.sources.quotes.optional_paid,
  ].filter((source): source is string => Boolean(source));
  const macroSources = Object.values(config.sources.macro).filter((source): source is string => Boolean(source));
  const sources: MarketIntelDataQualitySource[] = [
    {
      id: "calendar.static",
      collector: "calendar",
      source: config.calendar.provider,
      tier: "official",
      status: calendar.status === "closed" ? "skipped" : "ok",
      message: calendar.status === "closed" ? "All configured markets are closed for this run date." : "Static calendar guard completed.",
    },
    {
      id: "quotes.placeholder",
      collector: "quotes",
      source: quoteSources.join(", ") || "none",
      tier: "placeholder",
      status: "not_implemented",
      message: "Quote snapshot collector is planned for phase 3.",
    },
    {
      id: "macro.placeholder",
      collector: "macro",
      source: macroSources.join(", ") || "none",
      tier: "placeholder",
      status: "not_implemented",
      message: "Macro/policy collectors are planned for phase 4.",
    },
    {
      id: "news.placeholder",
      collector: "news",
      source: config.sources.news.provider,
      tier: "placeholder",
      status: "not_implemented",
      message: "News collector is planned for phase 4.",
    },
    {
      id: "earnings.placeholder",
      collector: "earnings",
      source: config.sources.earnings.provider,
      tier: "placeholder",
      status: "not_implemented",
      message: "Earnings and filings collectors are planned for phase 4.",
    },
    {
      id: "sectors.placeholder",
      collector: "sectors",
      source: config.sources.sectors.provider,
      tier: "placeholder",
      status: "not_implemented",
      message: "Sector collector is planned for phase 3.",
    },
  ];
  sources.push({
    id: "portfolio.stock-portfolio",
    collector: "portfolio",
    source: config.portfolio_provider_config ?? "none",
    tier: config.portfolio_provider_config ? "local_readonly" : "placeholder",
    status: portfolioContext.status === "not_configured"
      ? "skipped"
      : portfolioContext.status === "partial"
        ? "partial"
        : "ok",
    message: portfolioContext.status === "not_configured"
      ? "No portfolio provider config is set."
      : `stock-portfolio completed: ok=${portfolioContext.ok_count}, failed=${portfolioContext.failed_count}.`,
  });
  return sources;
}

function buildDataQuality(
  config: MarketIntelProviderConfig,
  calendar: MarketIntelCalendarSnapshot,
  portfolioContext: MarketIntelPortfolioContext,
): MarketIntelDataQuality {
  const sources = buildSourceQuality(config, calendar, portfolioContext);
  const warnings = sources
    .filter((source) => source.status === "not_implemented" || source.status === "failed" || source.status === "missing_config")
    .map((source) => `${source.collector}: ${source.message ?? source.status}`);
  warnings.push(...portfolioContext.warnings.map((warning) => `portfolio: ${warning}`));
  return {
    status: warnings.length ? "partial" : "ok",
    warnings,
    sources,
  };
}

function buildCalendarEvidence(args: PreProviderRunArgs, calendar: MarketIntelCalendarSnapshot): MarketIntelEvidenceItem {
  return {
    id: "calendar.static.1",
    category: "calendar",
    source: "market-intel static calendar",
    source_tier: "official",
    captured_at: args.runAt.toISOString(),
    summary: `Calendar status=${calendar.status}; tradable=${calendar.tradable_markets.join(", ") || "none"}; closed=${calendar.closed_markets.join(", ") || "none"}.`,
  };
}

function buildPortfolioEvidence(
  args: PreProviderRunArgs,
  portfolioContext: MarketIntelPortfolioContext,
): MarketIntelEvidenceItem | undefined {
  if (portfolioContext.status === "not_configured") return undefined;
  return {
    id: "portfolio.stock-portfolio.1",
    category: "portfolio",
    source: `stock-portfolio/${portfolioContext.profile ?? "default"}`,
    source_tier: "local_readonly",
    captured_at: args.runAt.toISOString(),
    summary: `Portfolio context status=${portfolioContext.status}; ok_sources=${portfolioContext.ok_count}; failed_sources=${portfolioContext.failed_count}; warnings=${portfolioContext.warnings.length}.`,
  };
}

function roleProtocol(): MarketIntelRoleProtocol {
  return {
    roles: [
      "Macro, Policy & Liquidity",
      "Flow, Positioning & Technical",
      "Cross-Market Sector & Theme",
      "Earnings, Valuation & Catalyst",
      "Risk, Scenario & Devil's Advocate",
    ],
    editor: "Forecast Editor",
    required_fields: ["conclusion", "evidence_ids", "confidence", "what_would_change_the_view"],
  };
}

export function buildMarketIntelPayload(params: {
  args: PreProviderRunArgs;
  configName: string;
  config: MarketIntelProviderConfig;
  calendar: MarketIntelCalendarSnapshot;
  portfolioContext?: MarketIntelPortfolioContext;
  skipReason?: string;
}): MarketIntelPayload {
  const portfolioContext = params.portfolioContext ?? buildNotConfiguredPortfolioContext();
  const evidence = [
    buildCalendarEvidence(params.args, params.calendar),
    buildPortfolioEvidence(params.args, portfolioContext),
  ].filter((item): item is MarketIntelEvidenceItem => item !== undefined);
  return {
    generated_at: params.args.runAt.toISOString(),
    source: "market-intel",
    profile: params.configName,
    market_scope: params.config.market_scope,
    session: params.config.session,
    run_context: {
      job_name: params.args.jobName,
      channel_id: params.args.channelId,
      timezone: params.config.timezone,
      calendar_status: params.calendar.status,
      trade_date: params.calendar.trade_date,
      skipped: Boolean(params.skipReason),
      skip_reason: params.skipReason,
      open_markets: params.calendar.open_markets,
      tradable_markets: params.calendar.tradable_markets,
      closed_markets: params.calendar.closed_markets,
    },
    calendar: params.calendar,
    data_quality: buildDataQuality(params.config, params.calendar, portfolioContext),
    portfolio_context: portfolioContext,
    market_snapshot: buildMarketIntelMarketSnapshot(params.config),
    macro_policy: placeholder(["Macro/policy collector is not implemented in phase 1. Do not infer policy changes from this placeholder."]),
    news: placeholder(["News collector is not implemented in phase 1. Do not invent headlines."]),
    earnings: placeholder(["Earnings collector is not implemented in phase 1. Do not invent earnings dates or surprises."]),
    filings: placeholder(["Filings collector is not implemented in phase 1. Do not invent SEC/exchange filings."]),
    risks: placeholder(["Risk collector is not implemented in phase 1. Use this payload only as a skeleton until risk evidence exists."]),
    scores: buildMarketIntelScores({ marketScope: params.config.market_scope, evidence }),
    evidence,
    role_protocol: roleProtocol(),
    usage_notes: [
      "This market-intel payload contains implemented calendar and optional portfolio evidence plus structured placeholders for later market collectors.",
      "Portfolio context, when configured, is read-only and already redacted by stock-portfolio before this payload is built.",
      "The downstream LLM must cite evidence IDs for factual claims and mark unsupported market views as hypotheses.",
      "No automatic trading, order placement, broker unlock, raw account ID, token, cookie, validatekey, or session data is allowed.",
      "Directional scores remain insufficient_data until quote, macro, sector, news, earnings, and risk collectors are implemented.",
    ],
  };
}

export function formatMarketIntelPayload(payload: MarketIntelPayload): string {
  return JSON.stringify(redactJsonStringValues(payload), null, 2);
}
