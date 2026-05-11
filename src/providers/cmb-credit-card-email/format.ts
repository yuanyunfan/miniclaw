import type { CmbCreditCardCollectResult, CmbCreditCardTransaction } from "./types.js";

const CHINA_TIME_OFFSET_MS = 8 * 3600_000;

function formatChinaLocalTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Date(parsed.getTime() + CHINA_TIME_OFFSET_MS)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
}

function compactTransaction(transaction: CmbCreditCardTransaction): Record<string, unknown> {
  return {
    id: transaction.id,
    occurred_at: formatChinaLocalTime(transaction.occurred_at),
    occurred_at_utc: transaction.occurred_at,
    occurred_timezone: "Asia/Shanghai",
    direction: transaction.direction,
    amount: transaction.amount,
    currency: transaction.currency,
    merchant: transaction.merchant,
    card_tail_hash: transaction.card_tail_hash,
    message_id_hash: transaction.message_id_hash,
    source_medium: transaction.source_medium,
  };
}

export function formatCmbCreditCardCollectResult(result: CmbCreditCardCollectResult): string {
  return JSON.stringify({
    generated_at: result.generated_at,
    window_start: result.window_start,
    window_end: result.window_end,
    currency: result.currency,
    transaction_count: result.transaction_count,
    skipped_duplicates: result.skipped_duplicates,
    total_spend: result.total_spend,
    total_refund: result.total_refund,
    net_spend: result.net_spend,
    large_transaction_threshold: result.large_transaction_threshold,
    large_transactions: result.large_transactions.map(compactTransaction),
    transactions: result.transactions.map(compactTransaction),
    diagnostics: result.diagnostics,
    warnings: result.warnings,
  }, null, 2);
}
