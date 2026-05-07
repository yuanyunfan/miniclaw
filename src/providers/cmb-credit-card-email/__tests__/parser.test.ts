import { describe, expect, it } from "vitest";
import { parseCmbCreditCardTransactions } from "../parser.js";
import type { EmailMessage } from "../../../capabilities/email/types.js";

function message(text: string): EmailMessage {
  return {
    id: "m1",
    profile: "cmb",
    folder: "INBOX",
    provider_uid: "1",
    message_id_hash: "sha256:message",
    received_at: "2026-05-07T12:00:00.000Z",
    from: { address: "notice@cmbchina.com" },
    to: [],
    subject: "招商银行信用卡消费提醒",
    text,
    attachments: [],
  };
}

describe("parseCmbCreditCardTransactions", () => {
  it("parses a single CMB credit card spend notification", () => {
    const transactions = parseCmbCreditCardTransactions(message(
      "您尾号1234信用卡于2026年05月07日 19:31在星巴克消费人民币68.50元，商户：星巴克上海。",
    ), { currency: "CNY" });

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      direction: "spend",
      amount: 68.5,
      currency: "CNY",
      merchant: "星巴克上海",
    });
    expect(transactions[0].card_tail_hash).toMatch(/^sha256:/);
    expect(JSON.stringify(transactions)).not.toContain("1234");
  });

  it("parses refund direction", () => {
    const transactions = parseCmbCreditCardTransactions(message(
      "招商银行信用卡退款提醒：05月07日 20:01 退款人民币12.30元，商户：测试商户，尾号1234。",
    ), { currency: "CNY" });

    expect(transactions[0]).toMatchObject({ direction: "refund", amount: 12.3 });
  });
});
