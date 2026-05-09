import { describe, expect, it } from "vitest";
import { formatCmbCreditCardCollectResult } from "../format.js";

describe("formatCmbCreditCardCollectResult", () => {
  it("does not include raw email body or card tail values", () => {
    const text = formatCmbCreditCardCollectResult({
      generated_at: "2026-05-07T14:00:00.000Z",
      window_start: "2026-05-06T14:00:00.000Z",
      window_end: "2026-05-07T14:00:00.000Z",
      currency: "CNY",
      transaction_count: 1,
      skipped_duplicates: 0,
      total_spend: 68.5,
      total_refund: 0,
      net_spend: 68.5,
      large_transaction_threshold: 1000,
      large_transactions: [],
      transactions: [{
        id: "sha256:tx",
        message_id_hash: "sha256:message",
        occurred_at: "2026-05-07T11:31:00.000Z",
        direction: "spend",
        amount: 68.5,
        currency: "CNY",
        merchant: "星巴克",
        card_tail_hash: "sha256:tail",
        source_medium: "body",
        source: "cmb-credit-card-email",
      }],
      diagnostics: {
        matched_email_count: 1,
        candidate_email_count: 1,
        attachment_count: 0,
        downloadable_attachment_count: 0,
        parsed_from_body_count: 1,
        parsed_from_attachment_count: 0,
        unsupported_attachment_count: 0,
        failed_attachment_count: 0,
        skipped_reason_counts: {},
        latest_candidates: [],
      },
      warnings: [],
    });

    expect(JSON.parse(text)).toMatchObject({ transaction_count: 1, net_spend: 68.5 });
    expect(text).not.toContain("1234");
    expect(text).not.toContain("原始邮件");
  });
});
