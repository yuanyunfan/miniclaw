import type { PreProviderResult, PreProviderRunArgs } from "../../providers/types.js";
import type {
  ProviderContext,
  ProviderDryRunResult,
  ProviderHealthResult,
  ProviderManifest,
  ProviderModule,
} from "../../providers/framework.js";
import {
  categorizeProviderError,
  providerDryRunFromError,
  providerHealthFromError,
  runProviderModuleAsPreProvider,
} from "../../providers/framework.js";
import {
  HttpEastmoneyJywgClient,
  loadEastmoneyJywgConfig,
  loadEastmoneyJywgSession,
  mapEastmoneyJywgRawBrokerData,
  resolveEastmoneyJywgProfile,
  sanitizeEastmoneyJywgError as sanitizeError,
  saveEastmoneyJywgSession,
  type EastmoneyJywgClient,
  type EastmoneyJywgConfig,
  type EastmoneyJywgProfileConfig,
  type EastmoneyJywgRawBrokerData,
  type EastmoneyJywgSession,
} from "../sources/eastmoney/index.js";
import {
  loadEastmoneyJywgProviderConfig,
  resolveEastmoneyJywgProviderMarketSession,
} from "../../providers/eastmoney-jywg-readonly/config.js";
import {
  buildEastmoneyJywgProviderPayload,
  formatEastmoneyJywgProviderPayload,
} from "../../providers/eastmoney-jywg-readonly/format.js";
import type {
  EastmoneyJywgDryRunSummary,
  EastmoneyJywgProviderConfig,
  EastmoneyJywgProviderPayload,
  EastmoneyJywgProviderRunResult,
} from "../../providers/eastmoney-jywg-readonly/types.js";

export interface EastmoneyJywgProviderDeps {
  client?: EastmoneyJywgClient;
  loadProviderConfig?: (name?: string) => EastmoneyJywgProviderConfig;
  loadEastmoneyConfig?: () => EastmoneyJywgConfig;
  loadSession?: (path: string) => EastmoneyJywgSession;
  saveSession?: (path: string, session: EastmoneyJywgSession) => void;
}

export const eastmoneyJywgProviderManifest: ProviderManifest = {
  name: "eastmoney-jywg-readonly",
  kind: "stock",
  privacy: "sensitive",
  sideEffects: "state_commit_after_success",
  supportsDryRun: true,
  supportsHealthCheck: true,
  outputSchemaVersion: "eastmoney-jywg-readonly.payload.v1",
};

interface EastmoneyJywgRuntime {
  providerConfig: EastmoneyJywgProviderConfig;
  profile: EastmoneyJywgProfileConfig;
  marketSession: string;
  client: EastmoneyJywgClient;
}

function normalizeProviderConfig(config: EastmoneyJywgProviderConfig): EastmoneyJywgProviderConfig {
  return {
    ...config,
    asset_gap_policy: config.asset_gap_policy ?? { positive_market_value_gap: "unclassified" },
  };
}

function resolveRuntime(context: ProviderContext, deps: EastmoneyJywgProviderDeps): EastmoneyJywgRuntime {
  const providerConfig = normalizeProviderConfig((deps.loadProviderConfig ?? loadEastmoneyJywgProviderConfig)(context.configName));
  const eastmoneyConfig = (deps.loadEastmoneyConfig ?? loadEastmoneyJywgConfig)();
  const profile = resolveEastmoneyJywgProfile(eastmoneyConfig, providerConfig.profile, {
    account_alias: providerConfig.account_alias,
    redaction: providerConfig.redaction,
  });
  return {
    providerConfig,
    profile,
    marketSession: resolveEastmoneyJywgProviderMarketSession(providerConfig, context.jobName),
    client: deps.client ?? new HttpEastmoneyJywgClient(),
  };
}

function safeRuntimeDetails(runtime: EastmoneyJywgRuntime, session?: EastmoneyJywgSession): Record<string, unknown> {
  return {
    profile: runtime.providerConfig.profile,
    account_alias_present: Boolean(runtime.profile.account_alias),
    market_session: runtime.marketSession,
    redaction: runtime.providerConfig.redaction,
    include_orders: runtime.profile.include_orders,
    include_deals: runtime.profile.include_deals,
    include_account_snapshot: runtime.providerConfig.include_account_snapshot,
    include_daily_report: runtime.providerConfig.include_daily_report,
    include_positions_summary: runtime.providerConfig.include_positions_summary,
    include_asset_allocation: runtime.providerConfig.include_asset_allocation,
    asset_gap_policy: {
      positive_market_value_gap: runtime.providerConfig.asset_gap_policy.positive_market_value_gap,
      label_present: Boolean(runtime.providerConfig.asset_gap_policy.label),
    },
    host: new URL(runtime.profile.base_url).hostname,
    session: session
      ? {
          cookie_count: session.cookies.length,
          last_verified_at: session.last_verified_at,
          expires_at_hint: session.expires_at_hint,
        }
      : undefined,
  };
}

function buildDryRunSummary(payload: EastmoneyJywgProviderPayload): EastmoneyJywgDryRunSummary {
  return {
    generated_at: payload.generated_at,
    source: payload.source,
    profile: payload.profile,
    market_session: payload.market_session,
    redaction: payload.redaction,
    account_alias_present: Boolean(payload.account_alias),
    report_included: payload.report !== undefined,
    snapshot_included: payload.snapshot !== undefined,
    positions_summary_included: payload.positions_summary !== undefined,
    asset_summary_included: payload.asset_summary !== undefined,
    positions_count: payload.positions_summary?.positions_count ?? 0,
    top_positions_count: payload.positions_summary?.top_positions.length ?? 0,
    warning_count: payload.warnings.length,
  };
}

async function runEastmoneyJywgStructured(
  context: ProviderContext,
  deps: EastmoneyJywgProviderDeps = {},
): Promise<EastmoneyJywgProviderRunResult> {
  try {
    const runtime = resolveRuntime(context, deps);
    const session = (deps.loadSession ?? loadEastmoneyJywgSession)(runtime.profile.session_secret_path);
    const raw = await runtime.client.getRawBrokerData(runtime.profile, session, {
      includeOrders: runtime.profile.include_orders,
      includeDeals: runtime.profile.include_deals,
    });
    const snapshot = mapEastmoneyJywgRawBrokerData(raw, runtime.profile, runtime.marketSession);
    const payload = buildEastmoneyJywgProviderPayload(snapshot, runtime.profile, {
      generatedAt: context.runAt,
      profileName: runtime.providerConfig.profile,
      marketSession: runtime.marketSession,
      redaction: runtime.providerConfig.redaction,
      topPositionsLimit: runtime.providerConfig.top_positions_limit,
      includeAccountSnapshot: runtime.providerConfig.include_account_snapshot,
      includeDailyReport: runtime.providerConfig.include_daily_report,
      includePositionsSummary: runtime.providerConfig.include_positions_summary,
      includeAssetAllocation: runtime.providerConfig.include_asset_allocation,
      assetGapPolicy: runtime.providerConfig.asset_gap_policy,
    });
    return {
      payload,
      session_secret_path: runtime.profile.session_secret_path,
      updated_session: (raw as EastmoneyJywgRawBrokerData).updated_session,
    };
  } catch (err) {
    throw new Error(`eastmoney-jywg provider failed: ${sanitizeError(err)}`);
  }
}

export function createEastmoneyJywgProvider(
  deps: EastmoneyJywgProviderDeps = {},
): ProviderModule<EastmoneyJywgProviderRunResult> {
  return {
    manifest: eastmoneyJywgProviderManifest,
    async healthCheck(context: ProviderContext): Promise<ProviderHealthResult> {
      const checkedAt = new Date();
      try {
        const runtime = resolveRuntime(context, deps);
        const session = (deps.loadSession ?? loadEastmoneyJywgSession)(runtime.profile.session_secret_path);
        const health = await runtime.client.healthCheck(runtime.profile, session);
        const safeDetails = {
          ...safeRuntimeDetails(runtime, session),
          health: {
            host: health.host,
            session_ok: health.session.ok,
            cookie_count: health.session.cookie_count,
            last_verified_at: health.session.last_verified_at,
          },
        };
        if (!health.ok) {
          const message = sanitizeError(health.session.error ?? "eastmoney-jywg session health check failed");
          return {
            ok: false,
            category: categorizeProviderError(new Error(message)),
            message,
            checkedAt: checkedAt.toISOString(),
            safeDetails,
          };
        }
        return {
          ok: true,
          message: `eastmoney-jywg-readonly profile ${runtime.providerConfig.profile} is reachable`,
          checkedAt: checkedAt.toISOString(),
          safeDetails,
        };
      } catch (err) {
        return providerHealthFromError(new Error(`eastmoney-jywg health failed: ${sanitizeError(err)}`), checkedAt);
      }
    },
    async dryRun(context: ProviderContext): Promise<ProviderDryRunResult<EastmoneyJywgDryRunSummary>> {
      try {
        const result = await runEastmoneyJywgStructured(context, deps);
        const summary = buildDryRunSummary(result.payload);
        return {
          ok: true,
          structured: summary,
          previewText: JSON.stringify(summary, null, 2),
          redacted: true,
          warnings: result.payload.warnings.map(sanitizeError),
        };
      } catch (err) {
        return providerDryRunFromError(err);
      }
    },
    async run(context: ProviderContext): Promise<EastmoneyJywgProviderRunResult> {
      return await runEastmoneyJywgStructured(context, deps);
    },
    async format(result: EastmoneyJywgProviderRunResult): Promise<PreProviderResult> {
      return { text: formatEastmoneyJywgProviderPayload(result.payload) };
    },
    async commit(result: EastmoneyJywgProviderRunResult): Promise<void> {
      (deps.saveSession ?? saveEastmoneyJywgSession)(result.session_secret_path, result.updated_session);
    },
  };
}

export const eastmoneyJywgProvider = createEastmoneyJywgProvider();

export async function runEastmoneyJywgProvider(
  args: PreProviderRunArgs,
  deps: EastmoneyJywgProviderDeps = {},
): Promise<PreProviderResult> {
  return await runProviderModuleAsPreProvider(createEastmoneyJywgProvider(deps), args);
}
