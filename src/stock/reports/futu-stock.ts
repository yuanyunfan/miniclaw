import type { PreProviderResult, PreProviderRunArgs } from "../../providers/types.js";
import {
  loadFutuStockConfig,
  mapFutuRawBrokerData,
  PythonFutuStockClient,
  resolveFutuStockProfile,
  sanitizeError,
  type FutuStockClient,
  type FutuStockConfig,
} from "../sources/futu/index.js";
import { loadFutuStockProviderConfig, resolveFutuProviderMarketSession } from "../../providers/futu-stock/config.js";
import { buildFutuStockProviderPayload, formatFutuStockProviderPayload } from "./futu-stock-format.js";
import type { FutuStockProviderConfig } from "./futu-stock-types.js";

export interface FutuStockProviderDeps {
  client?: FutuStockClient;
  loadProviderConfig?: (name?: string) => FutuStockProviderConfig;
  loadFutuConfig?: () => FutuStockConfig;
}

export async function runFutuStockProvider(
  args: PreProviderRunArgs,
  deps: FutuStockProviderDeps = {},
): Promise<PreProviderResult> {
  const providerConfig = (deps.loadProviderConfig ?? loadFutuStockProviderConfig)(args.configName);
  const futuConfig = (deps.loadFutuConfig ?? loadFutuStockConfig)();
  const profile = resolveFutuStockProfile(futuConfig, providerConfig.profile, {
    account_alias: providerConfig.account_alias,
    redaction: providerConfig.redaction,
  });
  const marketSession = resolveFutuProviderMarketSession(providerConfig, args.jobName);
  const client = deps.client ?? new PythonFutuStockClient();

  try {
    const raw = await client.getRawBrokerData(profile);
    const snapshot = mapFutuRawBrokerData(raw, profile, marketSession);
    const payload = buildFutuStockProviderPayload(snapshot, profile, {
      generatedAt: args.runAt,
      profileName: providerConfig.profile,
      marketSession,
      redaction: providerConfig.redaction,
      topPositionsLimit: providerConfig.top_positions_limit,
      includeAccountSnapshot: providerConfig.include_account_snapshot,
      includeDailyReport: providerConfig.include_daily_report,
      includePositionsSummary: providerConfig.include_positions_summary,
      includeAssetAllocation: providerConfig.include_asset_allocation,
    });
    return { text: formatFutuStockProviderPayload(payload) };
  } catch (err) {
    throw new Error(`futu-stock provider failed: ${sanitizeError(err)}`);
  }
}
