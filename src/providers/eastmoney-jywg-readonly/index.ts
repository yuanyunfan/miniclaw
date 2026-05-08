import type { PreProviderResult, PreProviderRunArgs } from "../types.js";
import { HttpEastmoneyJywgClient } from "../../mcp/eastmoney-jywg/client.js";
import { loadEastmoneyJywgConfig, resolveEastmoneyJywgProfile } from "../../mcp/eastmoney-jywg/config.js";
import { mapEastmoneyJywgRawBrokerData } from "../../mcp/eastmoney-jywg/mapper.js";
import { sanitizeError } from "../../mcp/eastmoney-jywg/safety.js";
import { loadEastmoneyJywgSession, saveEastmoneyJywgSession } from "../../mcp/eastmoney-jywg/session-vault.js";
import type {
  EastmoneyJywgClient,
  EastmoneyJywgConfig,
  EastmoneyJywgRawBrokerData,
} from "../../mcp/eastmoney-jywg/types.js";
import {
  loadEastmoneyJywgProviderConfig,
  resolveEastmoneyJywgProviderMarketSession,
} from "./config.js";
import {
  buildEastmoneyJywgProviderPayload,
  formatEastmoneyJywgProviderPayload,
} from "./format.js";
import type { EastmoneyJywgProviderConfig } from "./types.js";

export interface EastmoneyJywgProviderDeps {
  client?: EastmoneyJywgClient;
  loadProviderConfig?: (name?: string) => EastmoneyJywgProviderConfig;
  loadEastmoneyConfig?: () => EastmoneyJywgConfig;
}

export async function runEastmoneyJywgProvider(
  args: PreProviderRunArgs,
  deps: EastmoneyJywgProviderDeps = {},
): Promise<PreProviderResult> {
  const providerConfig = (deps.loadProviderConfig ?? loadEastmoneyJywgProviderConfig)(args.configName);
  const eastmoneyConfig = (deps.loadEastmoneyConfig ?? loadEastmoneyJywgConfig)();
  const profile = resolveEastmoneyJywgProfile(eastmoneyConfig, providerConfig.profile, {
    account_alias: providerConfig.account_alias,
    redaction: providerConfig.redaction,
  });
  const marketSession = resolveEastmoneyJywgProviderMarketSession(providerConfig, args.jobName);
  const client = deps.client ?? new HttpEastmoneyJywgClient();

  try {
    const session = loadEastmoneyJywgSession(profile.session_secret_path);
    const raw = await client.getRawBrokerData(profile, session, {
      includeOrders: profile.include_orders,
      includeDeals: profile.include_deals,
    });
    const snapshot = mapEastmoneyJywgRawBrokerData(raw, profile, marketSession);
    const payload = buildEastmoneyJywgProviderPayload(snapshot, profile, {
      generatedAt: args.runAt,
      profileName: providerConfig.profile,
      marketSession,
      redaction: providerConfig.redaction,
      topPositionsLimit: providerConfig.top_positions_limit,
      includeAccountSnapshot: providerConfig.include_account_snapshot,
      includeDailyReport: providerConfig.include_daily_report,
      includePositionsSummary: providerConfig.include_positions_summary,
    });
    return {
      text: formatEastmoneyJywgProviderPayload(payload),
      commit: async () => {
        saveEastmoneyJywgSession(profile.session_secret_path, (raw as EastmoneyJywgRawBrokerData).updated_session);
      },
    };
  } catch (err) {
    throw new Error(`eastmoney-jywg provider failed: ${sanitizeError(err)}`);
  }
}
