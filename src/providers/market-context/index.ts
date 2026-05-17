import type { PreProviderResult, PreProviderRunArgs } from "../types.js";
import type {
  ProviderContext,
  ProviderDryRunResult,
  ProviderHealthResult,
  ProviderManifest,
  ProviderModule,
} from "../framework.js";
import {
  providerDryRunFromError,
  providerHealthFromError,
  runProviderModuleAsPreProvider,
} from "../framework.js";
import {
  getLatestMarketContextDaily,
  listActiveMarketContextItems,
  listRecentMarketContextDaily,
  type MarketContextDailyRow,
  type MarketContextScope,
} from "../../store/market-context.js";
import {
  findLatestMarketForecast,
  listMarketForecastItems,
  stripMarketForecastJsonForDisplay,
} from "../../store/market-forecasts.js";
import { zonedDateKey } from "../market-intel/calendar.js";
import { loadMarketContextProviderConfig } from "./config.js";
import type {
  MarketContextDailySummary,
  MarketContextForecastLoader,
  MarketContextForecastSummary,
  MarketContextProviderConfig,
  MarketContextProviderPayload,
} from "./types.js";

export interface MarketContextProviderDeps {
  loadProviderConfig?: (name?: string) => MarketContextProviderConfig;
  findForecast?: MarketContextForecastLoader;
  listForecastItems?: typeof listMarketForecastItems;
}

export const marketContextProviderManifest: ProviderManifest = {
  name: "market-context",
  kind: "stock",
  privacy: "private",
  sideEffects: "none",
  supportsDryRun: true,
  supportsHealthCheck: true,
  outputSchemaVersion: "market-context.payload.v1",
};

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function truncateText(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 18))}\n... (truncated)` : text;
}

function dailySummary(row: MarketContextDailyRow, maxDigestChars: number): MarketContextDailySummary {
  const activeItems = safeJsonParse(row.active_items_json);
  return {
    id: row.id,
    market_scope: row.market_scope,
    trade_date: row.trade_date,
    generated_at: row.generated_at,
    digest_text: truncateText(row.digest_text, maxDigestChars),
    active_items: Array.isArray(activeItems)
      ? activeItems as unknown[]
      : [],
    data_quality: safeJsonParse(row.data_quality_json) ?? {},
  };
}

function forecastScopeFor(scope: MarketContextScope, config: MarketContextProviderConfig): string | undefined {
  if (config.forecast_market_scope) return config.forecast_market_scope;
  if (scope === "us") return "us";
  if (scope === "cn-a" || scope === "hk") return "cn";
  return undefined;
}

function forecastSummary(params: {
  config: MarketContextProviderConfig;
  context: ProviderContext;
  tradeDate: string;
  deps: MarketContextProviderDeps;
}): MarketContextForecastSummary | undefined {
  if (!params.config.market_scope) return undefined;
  const marketScope = forecastScopeFor(params.config.market_scope, params.config);
  if (!marketScope) return undefined;
  const forecast = (params.deps.findForecast ?? findLatestMarketForecast)({
    marketScope,
    tradeDate: params.tradeDate,
    session: params.config.forecast_session,
  }) ?? (params.deps.findForecast ?? findLatestMarketForecast)({
    marketScope,
    session: params.config.forecast_session,
  });
  if (!forecast) return undefined;
  const items = (params.deps.listForecastItems ?? listMarketForecastItems)(forecast.id)
    .slice(0, params.config.max_items)
    .map((item) => ({
      item_type: item.item_type,
      target: item.target,
      direction: item.direction,
      probability: item.probability,
      confidence: item.confidence,
      evidence_ids_json: item.evidence_ids_json,
      rationale: item.rationale,
      source: item.source,
    }));
  return {
    id: forecast.id,
    market_scope: forecast.market_scope,
    trade_date: forecast.trade_date,
    session: forecast.session,
    generated_at: forecast.generated_at,
    data_quality_status: forecast.data_quality_status,
    report_excerpt: forecast.report_text
      ? truncateText(stripMarketForecastJsonForDisplay(forecast.report_text), params.config.max_digest_chars)
      : undefined,
    items,
  };
}

export function buildMarketContextProviderPayload(
  context: ProviderContext,
  deps: MarketContextProviderDeps = {},
): MarketContextProviderPayload {
  const profile = context.configName ?? "default";
  const config = (deps.loadProviderConfig ?? loadMarketContextProviderConfig)(profile);
  const tradeDate = zonedDateKey(context.runAt, config.timezone);
  const requestedScopes = config.mode === "update" && config.market_scope
    ? [config.market_scope]
    : config.market_scopes;
  const previousContexts = requestedScopes
    .map((scope) => getLatestMarketContextDaily(scope))
    .filter((row): row is MarketContextDailyRow => row !== undefined)
    .map((row) => dailySummary(row, config.max_digest_chars));
  const activeItems = listActiveMarketContextItems(
    requestedScopes,
    context.runAt.toISOString(),
    config.max_items
  );

  return {
    generated_at: context.runAt.toISOString(),
    source: "market-context",
    profile,
    mode: config.mode,
    run_context: {
      job_name: context.jobName,
      channel_id: context.channelId,
      timezone: config.timezone,
      trade_date: tradeDate,
      target_market_scope: config.market_scope,
      requested_market_scopes: requestedScopes,
    },
    previous_contexts: config.mode === "update"
      ? requestedScopes.flatMap((scope) =>
        listRecentMarketContextDaily(scope, Math.min(7, config.lookback_days))
          .map((row) => dailySummary(row, config.max_digest_chars))
      )
      : previousContexts,
    active_items: activeItems,
    latest_forecast: config.mode === "update"
      ? forecastSummary({ config, context, tradeDate, deps })
      : undefined,
    usage_notes: [
      "market-context is rolling market background, not a real-time quote source.",
      "Use it to preserve macro/news/regime memory across stock cron tasks; use the task's primary provider for latest quotes and portfolio facts.",
      "If market-context conflicts with fresher provider evidence, prefer the fresher provider evidence and call out the conflict.",
      "When mode=update, the downstream report must include a <market_context_json> block so MiniClaw can persist the updated context.",
    ],
  };
}

export const marketContextProvider: ProviderModule<MarketContextProviderPayload> = {
  manifest: marketContextProviderManifest,
  async healthCheck(context): Promise<ProviderHealthResult> {
    try {
      const config = loadMarketContextProviderConfig(context.configName ?? "default");
      return {
        ok: true,
        message: `market-context config is loadable: mode=${config.mode}, scopes=${config.market_scopes.join(",")}`,
        checkedAt: context.runAt.toISOString(),
      };
    } catch (err) {
      return providerHealthFromError(err, context.runAt);
    }
  },
  async dryRun(context): Promise<ProviderDryRunResult<MarketContextProviderPayload>> {
    try {
      const structured = buildMarketContextProviderPayload(context);
      return {
        ok: true,
        structured,
        previewText: JSON.stringify(structured, null, 2).slice(0, 6000),
        redacted: true,
        warnings: [],
      };
    } catch (err) {
      return providerDryRunFromError<MarketContextProviderPayload>(err);
    }
  },
  async run(context): Promise<MarketContextProviderPayload> {
    return buildMarketContextProviderPayload(context);
  },
  async format(result): Promise<PreProviderResult> {
    return { text: JSON.stringify(result, null, 2) };
  },
};

export async function runMarketContextProvider(
  args: PreProviderRunArgs,
  deps: MarketContextProviderDeps = {},
): Promise<PreProviderResult> {
  if (!Object.keys(deps).length) {
    return await runProviderModuleAsPreProvider(marketContextProvider, args);
  }
  const context: ProviderContext = {
    configName: args.configName,
    jobName: args.jobName,
    channelId: args.channelId,
    runAt: args.runAt,
  };
  const structured = buildMarketContextProviderPayload(context, deps);
  return await marketContextProvider.format(structured, context);
}
