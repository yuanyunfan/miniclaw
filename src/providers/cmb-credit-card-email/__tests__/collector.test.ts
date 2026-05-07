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
  });
});
