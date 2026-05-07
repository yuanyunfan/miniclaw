import type { PreProviderResult, PreProviderRunArgs } from "../types.js";
import { loadFutuStockConfig, resolveFutuStockProfile } from "../../mcp/futu-stock/config.js";
import { PythonFutuStockClient } from "../../mcp/futu-stock/futu-client.js";
import { mapFutuRawBrokerData } from "../../mcp/futu-stock/mapper.js";
import { sanitizeError } from "../../mcp/futu-stock/safety.js";
import type { FutuStockClient, FutuStockConfig } from "../../mcp/futu-stock/types.js";
import { loadFutuStockProviderConfig, resolveFutuProviderMarketSession } from "./config.js";
import { buildFutuStockProviderPayload, formatFutuStockProviderPayload } from "./format.js";
import type { FutuStockProviderConfig } from "./types.js";

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
    });
    return { text: formatFutuStockProviderPayload(payload) };
  } catch (err) {
    throw new Error(`futu-stock provider failed: ${sanitizeError(err)}`);
  }
}
