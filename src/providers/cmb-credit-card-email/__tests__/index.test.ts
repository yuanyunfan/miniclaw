import { describe, expect, it } from "vitest";
import { getCmbCreditCardSkipReason } from "../index.js";
import type { CmbCreditCardCollectResult } from "../types.js";

function result(overrides: Partial<CmbCreditCardCollectResult> = {}): CmbCreditCardCollectResult {
  return {
    generated_at: "2026-05-10T12:00:00.000Z",
    window_start: "2026-05-09T12:00:00.000Z",
    window_end: "2026-05-10T12:00:00.000Z",
    currency: "CNY",
    transaction_count: 0,
    skipped_duplicates: 0,
    total_spend: 0,
    total_refund: 0,
    net_spend: 0,
    large_transaction_threshold: 1000,
    large_transactions: [],
    transactions: [],
    diagnostics: {
      matched_email_count: 0,
      candidate_email_count: 0,
      attachment_count: 0,
      downloadable_attachment_count: 0,
      parsed_from_body_count: 0,
      parsed_from_attachment_count: 0,
      unsupported_attachment_count: 0,
      failed_attachment_count: 0,
      skipped_reason_counts: {},
      latest_candidates: [],
    },
    warnings: [],
    ...overrides,
  };
}

describe("getCmbCreditCardSkipReason", () => {
  it("does not skip when new transactions were parsed", () => {
    expect(getCmbCreditCardSkipReason(result({ transaction_count: 1 }))).toBeUndefined();
  });

  it("skips when no matching CMB credit card email was found", () => {
    expect(getCmbCreditCardSkipReason(result())).toBe("no_matching_cmb_credit_card_email");
  });

  it("skips duplicate-only polling runs", () => {
    expect(getCmbCreditCardSkipReason(result({ skipped_duplicates: 2 })))
      .toBe("no_new_transactions_all_parsed_transactions_are_duplicates");
  });

  it("skips matched emails that still produced no new parsed transactions", () => {
    expect(getCmbCreditCardSkipReason(result({
      diagnostics: {
        ...result().diagnostics,
        matched_email_count: 1,
        candidate_email_count: 1,
      },
    }))).toBe("no_new_parsed_transactions");
  });
});
