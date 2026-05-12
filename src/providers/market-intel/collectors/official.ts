import type { PreProviderRunArgs } from "../../types.js";
import type { MarketIntelEvidenceCollection, MarketIntelProviderConfig } from "../types.js";
import { collectOfficialEventEvidence } from "./events.js";
import { collectOfficialMacroEvidence } from "./macro.js";
import { collectOfficialNewsEvidence } from "./news.js";
import { FetchMarketIntelOfficialHttpClient } from "./official-http.js";
import type { MarketIntelOfficialHttpClient } from "./official-shared.js";
import {
  buildEmptyMarketIntelEvidenceCollection,
  splitOfficialEvidenceCollection,
} from "./scoring-input.js";

export type { MarketIntelOfficialHttpClient } from "./official-shared.js";
export { buildEmptyMarketIntelEvidenceCollection } from "./scoring-input.js";

export async function collectMarketIntelOfficialEvidence(
  params: {
    args: PreProviderRunArgs;
    config: MarketIntelProviderConfig;
  },
  deps: { http?: MarketIntelOfficialHttpClient } = {},
): Promise<MarketIntelEvidenceCollection> {
  const http = deps.http ?? new FetchMarketIntelOfficialHttpClient();
  const collectorParams = { ...params, http };
  const [macroResults, newsResults, eventResults] = await Promise.all([
    collectOfficialMacroEvidence(collectorParams),
    collectOfficialNewsEvidence(collectorParams),
    collectOfficialEventEvidence(collectorParams),
  ]);
  return splitOfficialEvidenceCollection(params.args, params.config, [
    ...macroResults,
    ...newsResults,
    ...eventResults,
  ]);
}
