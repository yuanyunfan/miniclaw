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

  it("does not parse credit manager summary amounts as transactions", () => {
    const transactions = parseCmbCreditCardTransactions({
      ...message("截至05月09日 15:12，您的尾号1234信用卡可用额度人民币71,919.20元，5月权益活动一览。"),
      subject: "每日信用管家",
    }, { currency: "CNY" });

    expect(transactions).toHaveLength(0);
  });

  it("parses daily credit manager transaction details without using the available credit amount", () => {
    const transactions = parseCmbCreditCardTransactions({
      ...message([
        "截至昨日最后一笔交易，您的额度和积分信息如下：",
        "￥71,919.20",
        "可用额度",
        "2026/05/08&nbsp;您的消费明细如下：",
        "17:56:39",
        "CNY&nbsp;38.80",
        "尾号1234&nbsp;消费&nbsp;支付宝-迪卡侬北京中关村店",
        "18:31:22",
        "CNY&nbsp;47.12",
        "尾号1234&nbsp;消费&nbsp;支付宝-鲍师傅糕点",
      ].join("\n")),
      subject: "每日信用管家",
    }, { currency: "CNY" });

    expect(transactions.map((transaction) => transaction.amount)).toEqual([38.8, 47.12]);
    expect(transactions.map((transaction) => transaction.merchant)).toEqual([
      "支付宝-迪卡侬北京中关村店",
      "支付宝-鲍师傅糕点",
    ]);
    expect(transactions.map((transaction) => transaction.occurred_at)).toEqual([
      "2026-05-08T09:56:39.000Z",
      "2026-05-08T10:31:22.000Z",
    ]);
    expect(transactions.some((transaction) => transaction.amount === 71919.2)).toBe(false);
  });

  it("keeps the daily credit manager date for long transaction detail lists", () => {
    const transactions = parseCmbCreditCardTransactions({
      ...message([
        "截至昨日最后一笔交易，您的额度和积分信息如下：",
        "￥71,546.44",
        "可用额度",
        "2026/05/09 您的消费明细如下：",
        "11:03:59",
        "CNY 299.80",
        "尾号1234 消费 财付通-国网北京市电力公司",
        "11:51:04",
        "CNY 27.50",
        "尾号1234 消费 美团支付-美团App拌将麻辣拌麻辣烫BA",
        "11:51:15",
        "CNY -27.50",
        "尾号1234 退货 美团支付-美团App拌将麻辣拌麻辣烫BANJIA",
        "11:53:55",
        "CNY 25.80",
        "尾号1234 消费 美团支付-美团App拌将麻辣拌麻辣烫(",
        "15:40:19",
        "CNY 12.20",
        "尾号1234 消费 支付宝-上海拉扎斯信息科技有限公司",
        "17:50:43",
        "CNY 14.42",
        "尾号1234 消费 美团支付-美团App融柳大铁牛螺蛳粉（",
        "19:36:52",
        "CNY 20.54",
        "尾号1234 消费 美团支付-美团App乐购达超市（芍药居",
      ].join("\n")),
      received_at: "2026-05-10T07:13:48.000Z",
      subject: "每日信用管家",
    }, { currency: "CNY" });

    expect(transactions.map((transaction) => transaction.amount)).toEqual([299.8, 27.5, -27.5, 25.8, 12.2, 14.42, 20.54]);
    expect(transactions.map((transaction) => transaction.occurred_at)).toEqual([
      "2026-05-09T03:03:59.000Z",
      "2026-05-09T03:51:04.000Z",
      "2026-05-09T03:51:15.000Z",
      "2026-05-09T03:53:55.000Z",
      "2026-05-09T07:40:19.000Z",
      "2026-05-09T09:50:43.000Z",
      "2026-05-09T11:36:52.000Z",
    ]);
  });

  it("parses extracted attachment text", () => {
    const transactions = parseCmbCreditCardTransactions({
      ...message("招商银行信用卡电子账单"),
      attachments: [{
        filename: "statement.csv",
        content_type: "text/csv",
        size: 120,
        text: "交易时间,交易商户,金额\n2026年05月07日 19:31,餐厅,人民币268.00元",
        extraction: { status: "extracted" },
      }],
    }, { currency: "CNY" });

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      amount: 268,
      source_medium: "attachment",
    });
  });
});
