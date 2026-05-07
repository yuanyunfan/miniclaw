import { searchEmailMessages } from "../../capabilities/email/query.js";
import type { EmailMessage, EmailSearchResult } from "../../capabilities/email/types.js";
import { parseCmbCreditCardTransactions } from "./parser.js";
import { isTransactionSeen, loadCmbCreditCardState, markTransactionsSeen, saveCmbCreditCardState } from "./state.js";
import type { CmbCreditCardCollectResult, CmbCreditCardEmailConfig, CmbCreditCardState, CmbCreditCardTransaction } from "./types.js";

export interface CollectCmbCreditCardOptions {
  now?: Date;
  state?: CmbCreditCardState;
  searcher?: (query: Parameters<typeof searchEmailMessages>[0]) => Promise<EmailSearchResult>;
}

function sum(transactions: CmbCreditCardTransaction[], direction: "spend" | "refund"): number {
  return Math.round(transactions
    .filter((transaction) => transaction.direction === direction)
    .reduce((total, transaction) => total + transaction.amount, 0) * 100) / 100;
}

export async function collectCmbCreditCardEmailTransactions(
  config: CmbCreditCardEmailConfig,
  options: CollectCmbCreditCardOptions = {},
): Promise<{ result: CmbCreditCardCollectResult; commit: () => Promise<void> }> {
  const now = options.now ?? new Date();
  const windowStart = new Date(now.getTime() - config.window_hours * 3600_000);
  const state = options.state ?? loadCmbCreditCardState(config.state_path);
  const searcher = options.searcher ?? searchEmailMessages;
  const emailResult = await searcher({
    profile: config.email_profile,
    folders: config.folders,
    from: config.from,
    subject_includes: config.subject_includes,
    received_after: windowStart.toISOString(),
    received_before: now.toISOString(),
    max_results: config.max_results,
    include_body: true,
    include_attachments: false,
  });

  const warnings = [...emailResult.warnings];
  const parsed = emailResult.messages.flatMap((message: EmailMessage) =>
    parseCmbCreditCardTransactions(message, { currency: config.currency })
  );
  const transactions = config.dedupe
    ? parsed.filter((transaction) => !isTransactionSeen(state, transaction))
    : parsed;
  const skippedDuplicates = parsed.length - transactions.length;
  if (emailResult.messages.length && !parsed.length) {
    warnings.push("Matched emails were found, but no CMB credit card transactions could be parsed.");
  }
  const totalSpend = sum(transactions, "spend");
  const totalRefund = sum(transactions, "refund");
  const result: CmbCreditCardCollectResult = {
    generated_at: now.toISOString(),
    window_start: windowStart.toISOString(),
    window_end: now.toISOString(),
    currency: config.currency,
    transaction_count: transactions.length,
    skipped_duplicates: skippedDuplicates,
    total_spend: totalSpend,
    total_refund: totalRefund,
    net_spend: Math.round((totalSpend - totalRefund) * 100) / 100,
    large_transaction_threshold: config.large_transaction_threshold,
    large_transactions: transactions.filter((transaction) => transaction.amount >= config.large_transaction_threshold),
    transactions,
    warnings,
  };
  return {
    result,
    commit: async () => {
      if (!config.dedupe) return;
      markTransactionsSeen(state, transactions);
      saveCmbCreditCardState(config.state_path, state);
    },
  };
}
