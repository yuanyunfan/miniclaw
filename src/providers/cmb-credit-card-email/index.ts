import type { PreProviderResult, PreProviderRunArgs } from "../types.js";
import { collectCmbCreditCardEmailTransactions } from "./collector.js";
import { loadCmbCreditCardEmailConfig } from "./config.js";
import { formatCmbCreditCardCollectResult } from "./format.js";

export async function runCmbCreditCardEmailProvider(args: PreProviderRunArgs): Promise<PreProviderResult> {
  const config = loadCmbCreditCardEmailConfig(args.configName);
  const collected = await collectCmbCreditCardEmailTransactions(config, { now: args.runAt });
  return {
    text: formatCmbCreditCardCollectResult(collected.result),
    commit: collected.commit,
  };
}
