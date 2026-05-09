import { searchEmailMessages } from "../../capabilities/email/query.js";
import type { EmailMessage, EmailSearchResult } from "../../capabilities/email/types.js";
import { domainOf } from "../../capabilities/email/redaction.js";
import { parseCmbCreditCardTransactions } from "./parser.js";
import { isTransactionSeen, loadCmbCreditCardState, markTransactionsSeen, saveCmbCreditCardState } from "./state.js";
import type { CmbCreditCardCollectResult, CmbCreditCardDiagnostics, CmbCreditCardEmailCandidate, CmbCreditCardEmailConfig, CmbCreditCardState, CmbCreditCardTransaction } from "./types.js";

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

function subjectExcerpt(subject: string): string {
  return subject.replace(/\s+/g, " ").trim().slice(0, 120);
}

function skippedReasons(messages: EmailMessage[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const message of messages) {
    for (const attachment of message.attachments) {
      const reason = attachment.extraction?.reason;
      if (!reason) continue;
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
  }
  return counts;
}

function candidates(messages: EmailMessage[]): CmbCreditCardEmailCandidate[] {
  return messages
    .slice()
    .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())
    .slice(0, 10)
    .map((message) => ({
      received_at: message.received_at,
      from_domain: domainOf(message.from.address),
      subject_excerpt: subjectExcerpt(message.subject),
      attachment_count: message.attachments.length,
      attachment_types: [...new Set(message.attachments.map((attachment) => attachment.content_type ?? "unknown"))],
      attachment_extraction_statuses: [...new Set(message.attachments.map((attachment) => attachment.extraction?.status ?? "metadata_only"))],
    }));
}

async function diagnosticEmailSearch(
  config: CmbCreditCardEmailConfig,
  searcher: (query: Parameters<typeof searchEmailMessages>[0]) => Promise<EmailSearchResult>,
  windowStart: Date,
  now: Date,
): Promise<EmailSearchResult | undefined> {
  if (!config.diagnostic_search) return undefined;
  return await searcher({
    profile: config.email_profile,
    folders: config.folders,
    from: config.from,
    subject_includes: [],
    received_after: windowStart.toISOString(),
    received_before: now.toISOString(),
    max_results: config.max_results,
    include_body: false,
    include_attachments: true,
  });
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
    include_attachments: config.include_attachments,
    include_attachment_content: config.include_attachments && config.parse_attachment_text,
    attachment_text_max_bytes: config.attachment_text_max_bytes,
    allowed_attachment_extensions: config.allowed_attachment_extensions,
  });
  const diagnosticResult = emailResult.messages.length
    ? undefined
    : await diagnosticEmailSearch(config, searcher, windowStart, now);

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
  if (!emailResult.messages.length && diagnosticResult?.messages.length) {
    warnings.push("CMB sender emails were found in the window, but none matched the configured subject filters.");
  }
  const attachmentCount = emailResult.messages.reduce((total, message) => total + message.attachments.length, 0);
  const attachmentStatuses = emailResult.messages.flatMap((message) =>
    message.attachments.map((attachment) => attachment.extraction?.status ?? "metadata_only")
  );
  if (attachmentCount > 0 && !parsed.some((transaction) => transaction.source_medium === "attachment")) {
    warnings.push("Attachments were found, but no CMB credit card transactions could be parsed from attachments.");
  }
  if (attachmentStatuses.includes("failed")) {
    warnings.push("One or more attachments failed extraction; see diagnostics.skipped_reason_counts.");
  }
  if (skippedDuplicates > 0) {
    warnings.push(`${skippedDuplicates} parsed transaction(s) were skipped as duplicates.`);
  }
  const candidateMessages = diagnosticResult?.messages ?? emailResult.messages;
  const diagnostics: CmbCreditCardDiagnostics = {
    matched_email_count: emailResult.messages.length,
    candidate_email_count: candidateMessages.length,
    attachment_count: attachmentCount || candidateMessages.reduce((total, message) => total + message.attachments.length, 0),
    downloadable_attachment_count: emailResult.messages.flatMap((message) => message.attachments)
      .filter((attachment) => attachment.extraction?.status === "extracted").length,
    parsed_from_body_count: parsed.filter((transaction) => transaction.source_medium === "body").length,
    parsed_from_attachment_count: parsed.filter((transaction) => transaction.source_medium === "attachment").length,
    unsupported_attachment_count: attachmentStatuses.filter((status) => status === "skipped").length,
    failed_attachment_count: attachmentStatuses.filter((status) => status === "failed").length,
    skipped_reason_counts: skippedReasons(emailResult.messages),
    latest_candidates: candidates(candidateMessages),
  };
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
    diagnostics,
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
