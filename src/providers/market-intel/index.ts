import type { PreProviderResult, PreProviderRunArgs } from "../types.js";
import { buildMarketIntelCalendarSnapshot } from "./calendar.js";
import { loadMarketIntelProviderConfig } from "./config.js";
import { buildMarketIntelPayload, formatMarketIntelPayload } from "./format.js";
import type { MarketIntelProviderConfig } from "./types.js";

export interface MarketIntelProviderDeps {
  loadProviderConfig?: (name?: string) => MarketIntelProviderConfig;
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
  const payload = buildMarketIntelPayload({
    args,
    configName,
    config,
    calendar,
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
  return { text };
}
