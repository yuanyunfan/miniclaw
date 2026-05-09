import { describe, expect, it } from "vitest";
import { collectCmbCreditCardEmailTransactions } from "../collector.js";
import type { CmbCreditCardEmailConfig } from "../types.js";
import type { EmailSearchResult } from "../../../capabilities/email/types.js";

const config: CmbCreditCardEmailConfig = {
  email_profile: "cmb",
  state_path: "unused",
  folders: ["INBOX"],
  from: ["cmbchina.com"],
  subject_includes: ["信用卡"],
  window_hours: 24,
  max_results: 10,
  currency: "CNY",
  large_transaction_threshold: 100,
  dedupe: true,
  include_attachments: true,
  parse_attachment_text: true,
  attachment_text_max_bytes: 128_000,
  allowed_attachment_extensions: [".txt", ".csv", ".html", ".htm", ".json", ".xml", ".zip"],
  diagnostic_search: true,
};

describe("collectCmbCreditCardEmailTransactions", () => {
  it("builds spend totals from parsed email messages", async () => {
    const searcher = async (): Promise<EmailSearchResult> => ({
      profile: "cmb",
      generated_at: "2026-05-07T14:00:00.000Z",
      query: { folders: ["INBOX"], max_results: 10 },
      warnings: [],
      messages: [{
        id: "m1",
        profile: "cmb",
        folder: "INBOX",
        provider_uid: "1",
        message_id_hash: "sha256:message",
        received_at: "2026-05-07T12:00:00.000Z",
        from: { address: "notice@cmbchina.com" },
        to: [],
        subject: "招商银行信用卡消费提醒",
        text: "您尾号1234信用卡于2026年05月07日 19:31消费人民币168.00元，商户：餐厅。",
        attachments: [],
      }],
    });

    const { result } = await collectCmbCreditCardEmailTransactions(config, {
      now: new Date("2026-05-07T14:00:00.000Z"),
      searcher,
      state: { updated_at: "2026-05-07T00:00:00.000Z", seen_transactions: {} },
    });

    expect(result.transaction_count).toBe(1);
    expect(result.total_spend).toBe(168);
    expect(result.net_spend).toBe(168);
    expect(result.large_transactions).toHaveLength(1);
    expect(result.diagnostics).toMatchObject({
      matched_email_count: 1,
      parsed_from_body_count: 1,
      parsed_from_attachment_count: 0,
    });
  });

  it("parses transactions from extracted attachment text", async () => {
    const searcher = async (): Promise<EmailSearchResult> => ({
      profile: "cmb",
      generated_at: "2026-05-07T14:00:00.000Z",
      query: { folders: ["INBOX"], max_results: 10 },
      warnings: [],
      messages: [{
        id: "m1",
        profile: "cmb",
        folder: "INBOX",
        provider_uid: "1",
        message_id_hash: "sha256:message",
        received_at: "2026-05-07T12:00:00.000Z",
        from: { address: "notice@cmbchina.com" },
        to: [],
        subject: "招商银行信用卡电子账单",
        attachments: [{
          filename: "statement.csv",
          content_type: "text/csv",
          size: 120,
          text: "交易时间,交易商户,金额\n2026年05月07日 19:31,餐厅,人民币268.00元",
          extraction: { status: "extracted" },
        }],
      }],
    });

    const { result } = await collectCmbCreditCardEmailTransactions(config, {
      now: new Date("2026-05-07T14:00:00.000Z"),
      searcher,
      state: { updated_at: "2026-05-07T00:00:00.000Z", seen_transactions: {} },
    });

    expect(result.transaction_count).toBe(1);
    expect(result.transactions[0]).toMatchObject({ amount: 268, source_medium: "attachment" });
    expect(result.diagnostics.parsed_from_attachment_count).toBe(1);
  });

  it("uses broad diagnostic search when subject filters miss CMB emails", async () => {
    let calls = 0;
    const searcher = async (): Promise<EmailSearchResult> => {
      calls += 1;
      if (calls === 1) {
        return {
          profile: "cmb",
          generated_at: "2026-05-07T14:00:00.000Z",
          query: { folders: ["INBOX"], max_results: 10 },
          warnings: ["No email messages matched the query window and filters."],
          messages: [],
        };
      }
      return {
        profile: "cmb",
        generated_at: "2026-05-07T14:00:00.000Z",
        query: { folders: ["INBOX"], max_results: 10 },
        warnings: [],
        messages: [{
          id: "m2",
          profile: "cmb",
          folder: "INBOX",
          provider_uid: "2",
          message_id_hash: "sha256:message2",
          received_at: "2026-05-07T13:00:00.000Z",
          from: { address: "service@message.cmbchina.com" },
          to: [],
          subject: "每日信用管家",
          attachments: [],
        }],
      };
    };

    const { result } = await collectCmbCreditCardEmailTransactions(config, {
      now: new Date("2026-05-07T14:00:00.000Z"),
      searcher,
      state: { updated_at: "2026-05-07T00:00:00.000Z", seen_transactions: {} },
    });

    expect(calls).toBe(2);
    expect(result.transaction_count).toBe(0);
    expect(result.diagnostics).toMatchObject({
      matched_email_count: 0,
      candidate_email_count: 1,
    });
    expect(result.warnings).toContain("CMB sender emails were found in the window, but none matched the configured subject filters.");
  });
});
