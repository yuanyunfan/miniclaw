import type { PreProviderResult, PreProviderRunArgs } from "../types.js";
import { collectCmbCreditCardEmailTransactions } from "./collector.js";
import { loadCmbCreditCardEmailConfig } from "./config.js";
import { formatCmbCreditCardCollectResult } from "./format.js";
import type { CmbCreditCardCollectResult } from "./types.js";

export function getCmbCreditCardSkipReason(result: CmbCreditCardCollectResult): string | undefined {
  if (result.transaction_count > 0) return undefined;
  if (result.skipped_duplicates > 0) return "no_new_transactions_all_parsed_transactions_are_duplicates";
  if (result.diagnostics.matched_email_count === 0 && result.diagnostics.candidate_email_count === 0) {
    return "no_matching_cmb_credit_card_email";
  }
  return "no_new_parsed_transactions";
}

export async function runCmbCreditCardEmailProvider(args: PreProviderRunArgs): Promise<PreProviderResult> {
  const config = loadCmbCreditCardEmailConfig(args.configName);
  const collected = await collectCmbCreditCardEmailTransactions(config, { now: args.runAt });
  const skipReason = config.skip_when_no_new_transactions
    ? getCmbCreditCardSkipReason(collected.result)
    : undefined;
  return {
    text: formatCmbCreditCardCollectResult(collected.result),
    ...(skipReason ? {
      skipTask: {
        reason: skipReason,
        message: `transactions=${collected.result.transaction_count}, matched_emails=${collected.result.diagnostics.matched_email_count}, candidate_emails=${collected.result.diagnostics.candidate_email_count}, skipped_duplicates=${collected.result.skipped_duplicates}`,
      },
    } : {}),
    commit: collected.commit,
  };
}
