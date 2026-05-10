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

export function sanitizeMarketIntelError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/(validatekey=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/(password|token|cookie|secret|session|account|customer|acc_id|account_id)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
    .replace(/([A-Za-z0-9+/=_-]{24,})/g, "[redacted]")
    .slice(0, 800);
}

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

function buildPortfolioContext(config: MarketIntelProviderConfig): MarketIntelPortfolioContext {
  if (!config.portfolio_provider_config) {
    return {
      status: "not_configured",
      notes: ["portfolio_provider_config is not set; portfolio integration is scheduled for phase 2."],
    };
  }
  return {
    status: "not_implemented",
    profile: config.portfolio_provider_config,
    notes: [
      `portfolio_provider_config=${config.portfolio_provider_config} is configured, but stock-portfolio integration is scheduled for phase 2.`,
    ],
  };
}

function buildSourceQuality(config: MarketIntelProviderConfig, calendar: MarketIntelCalendarSnapshot): MarketIntelDataQualitySource[] {
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
    id: "portfolio.placeholder",
    collector: "portfolio",
    source: config.portfolio_provider_config ?? "none",
    tier: "placeholder",
    status: config.portfolio_provider_config ? "not_implemented" : "skipped",
    message: config.portfolio_provider_config
      ? "Portfolio context integration is planned for phase 2."
      : "No portfolio provider config is set.",
  });
  return sources;
}

function buildDataQuality(config: MarketIntelProviderConfig, calendar: MarketIntelCalendarSnapshot): MarketIntelDataQuality {
  const sources = buildSourceQuality(config, calendar);
  const warnings = sources
    .filter((source) => source.status === "not_implemented" || source.status === "failed" || source.status === "missing_config")
    .map((source) => `${source.collector}: ${source.message ?? source.status}`);
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
  skipReason?: string;
}): MarketIntelPayload {
  const evidence = [buildCalendarEvidence(params.args, params.calendar)];
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
    data_quality: buildDataQuality(params.config, params.calendar),
    portfolio_context: buildPortfolioContext(params.config),
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
      "This phase-1 market-intel payload intentionally contains only calendar evidence and structured placeholders.",
      "The downstream LLM must cite evidence IDs for factual claims and mark unsupported market views as hypotheses.",
      "No automatic trading, order placement, broker unlock, raw account ID, token, cookie, validatekey, or session data is allowed.",
      "Directional scores remain insufficient_data until quote, macro, sector, news, earnings, and risk collectors are implemented.",
    ],
  };
}

export function formatMarketIntelPayload(payload: MarketIntelPayload): string {
  return JSON.stringify(redactJsonStringValues(payload), null, 2);
}
