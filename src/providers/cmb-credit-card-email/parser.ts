import type { EmailMessage } from "../../capabilities/email/types.js";
import { hashValue } from "../../capabilities/email/redaction.js";
import type { CmbCreditCardTransaction, CmbTransactionDirection } from "./types.js";

function normalizeAmount(raw: string): number | undefined {
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : undefined;
}

function findAmount(text: string): number | undefined {
  const patterns = [
    /(?:人民币|RMB|CNY|￥|¥)\s*([+-]?\d+(?:,\d{3})*(?:\.\d{1,2})?)/i,
    /([+-]?\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:元|人民币|RMB|CNY)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return normalizeAmount(match[1]);
  }
  return undefined;
}

function direction(text: string): CmbTransactionDirection {
  return /退款|退货|冲正|返还|撤销|退回|收入/.test(text) ? "refund" : "spend";
}

function findCardTail(text: string): string | undefined {
  return /(?:尾号|末四位|后四位|卡号后四位)[^\d]{0,8}(\d{4})/.exec(text)?.[1];
}

function findMerchant(text: string): string | undefined {
  const label = /(?:交易商户|消费商户|商户名称|商户|商家|交易描述|摘要)[:：]\s*([^\n，。；;]+)/.exec(text)?.[1]?.trim();
  if (label) return label.slice(0, 80);
  const atMerchant = /(?:在|于)\s*([^\n，。；;]{2,60}?)(?:消费|交易|支付|支出|付款)/.exec(text)?.[1]?.trim();
  if (atMerchant) return atMerchant.slice(0, 80);
  return undefined;
}

function parseDateWithYear(text: string): Date | undefined {
  const match = /(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})日?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second = "0"] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}

function parseDateWithoutYear(text: string, receivedAt: string): Date | undefined {
  const match = /(\d{1,2})月(\d{1,2})日?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (!match) return undefined;
  const base = new Date(receivedAt);
  const [, month, day, hour, minute, second = "0"] = match;
  return new Date(base.getFullYear(), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}

function findOccurredAt(text: string, message: EmailMessage): string {
  const parsed = parseDateWithYear(text) ?? parseDateWithoutYear(text, message.received_at);
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return message.received_at;
}

function bodyText(message: EmailMessage): string {
  return [message.subject, message.text, message.html]
    .filter((part): part is string => Boolean(part))
    .join("\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "\n");
}

function candidateBlocks(text: string): string[] {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const amountLines = lines.filter((line) =>
    /(?:人民币|RMB|CNY|￥|¥|\d+(?:,\d{3})*(?:\.\d{1,2})?\s*元)/i.test(line)
    && /信用卡|消费|交易|支付|支出|退款|商户|尾号/.test(line)
  );
  return amountLines.length ? amountLines : [text.replace(/\s+/g, " ").trim()];
}

export function parseCmbCreditCardTransactions(
  message: EmailMessage,
  options: { currency: string },
): CmbCreditCardTransaction[] {
  const text = bodyText(message);
  const blocks = candidateBlocks(text);
  const transactions: CmbCreditCardTransaction[] = [];
  const seen = new Set<string>();
  for (const [index, block] of blocks.entries()) {
    const amount = findAmount(block);
    if (amount === undefined) continue;
    const cardTail = findCardTail(block) ?? findCardTail(text);
    const occurredAt = findOccurredAt(block, message);
    const txDirection = direction(block);
    const merchant = findMerchant(block) ?? findMerchant(text);
    const id = hashValue([
      message.message_id_hash,
      index,
      occurredAt,
      txDirection,
      amount,
      options.currency,
      merchant ?? "",
      cardTail ? hashValue(`card-tail:${cardTail}`) : "",
    ].join("|"));
    if (seen.has(id)) continue;
    seen.add(id);
    transactions.push({
      id,
      message_id_hash: message.message_id_hash,
      occurred_at: occurredAt,
      direction: txDirection,
      amount,
      currency: options.currency,
      merchant,
      card_tail_hash: cardTail ? hashValue(`card-tail:${cardTail}`) : undefined,
      source: "cmb-credit-card-email",
    });
  }
  return transactions;
}
