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
  const afterAction = /(?:消费|交易|支付|支出|付款)\s+(?!人民币|RMB|CNY|￥|¥)([^\n，。；;]+)/i.exec(text)?.[1]?.trim();
  if (afterAction) return afterAction.slice(0, 80);
  return undefined;
}

function hasAmountSignal(text: string): boolean {
  return /(?:人民币|RMB|CNY|￥|¥)\s*[+-]?\d+(?:,\d{3})*(?:\.\d{1,2})?|[+-]?\d+(?:,\d{3})*(?:\.\d{1,2})?\s*(?:元|人民币|RMB|CNY)/i.test(text);
}

function hasTransactionSignal(text: string): boolean {
  return /消费|交易商户|消费商户|商户名称|商户|支付|支出|付款|退款|退货|冲正|撤销/.test(text);
}

function hasSummaryOnlySignal(text: string): boolean {
  return /可用额度|信用额度|总额度|额度|应还|待还|最低还款|账单日|还款日|积分|权益|活动|信用管家/.test(text);
}

function isLikelyTransactionBlock(text: string): boolean {
  if (!hasTransactionSignal(text)) return false;
  if (hasSummaryOnlySignal(text) && !/(消费|交易商户|消费商户|商户|支付|支出|付款|退款|退货|冲正|撤销)/.test(text)) {
    return false;
  }
  return true;
}

function hasSummaryAmountContext(text: string): boolean {
  return /可用额度|信用额度|总额度|额度|应还|待还|最低还款|账单日|还款日|积分/.test(text);
}

function findDateToken(text: string): string | undefined {
  const withYear = /(\d{4}[年/-]\d{1,2}[月/-]\d{1,2}日?)/.exec(text)?.[1];
  if (withYear) return withYear;
  return /(\d{1,2}月\d{1,2}日?)/.exec(text)?.[1];
}

function findTimeOnlyToken(text: string): string | undefined {
  return /^(\d{1,2}:\d{2}(?::\d{2})?)$/.exec(text.trim())?.[1];
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

interface CandidateBlock {
  text: string;
  sourceMedium: "body" | "attachment";
}

function normalizeBodyText(parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .join("\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/&yen;/gi, "￥")
    .replace(/&amp;/gi, "&")
    .replace(/\r/g, "\n");
}

function bodyText(message: EmailMessage): string {
  return normalizeBodyText([message.subject, message.text, message.html]);
}

function attachmentTexts(message: EmailMessage): string[] {
  return message.attachments
    .map((attachment) => attachment.text)
    .filter((text): text is string => Boolean(text?.trim()));
}

function nearestDateToken(lines: string[], index: number): string | undefined {
  const start = Math.max(0, index - 12);
  for (let i = index; i >= start; i -= 1) {
    const token = findDateToken(lines[i] ?? "");
    if (token) return token;
  }
  return undefined;
}

function nearestTimeToken(lines: string[], index: number): string | undefined {
  for (const offset of [-1, -2, 1, 2]) {
    const token = findTimeOnlyToken(lines[index + offset] ?? "");
    if (token) return token;
  }
  return undefined;
}

function withNearbyDateTime(lines: string[], index: number, block: string): string {
  if (parseDateWithYear(block) || parseDateWithoutYear(block, new Date().toISOString())) return block;
  const date = nearestDateToken(lines, index);
  const time = nearestTimeToken(lines, index);
  return date && time ? `${date} ${time} ${block}` : block;
}

function amountLineBlock(lines: string[], index: number): string | undefined {
  const line = lines[index] ?? "";
  const previous = lines[index - 1] ?? "";
  const next = lines[index + 1] ?? "";
  const next2 = lines[index + 2] ?? "";
  const immediate = [previous, line, next].filter(Boolean).join(" ");
  if (hasSummaryAmountContext(immediate)) return undefined;
  if (isLikelyTransactionBlock(line)) return withNearbyDateTime(lines, index, line);

  const nextContext = [line, next].filter(Boolean).join(" ");
  if (hasTransactionSignal(nextContext) && !hasSummaryAmountContext(nextContext)) {
    return withNearbyDateTime(lines, index, nextContext);
  }
  const extendedNextContext = [line, next, next2].filter(Boolean).join(" ");
  if (!hasAmountSignal(next) && hasTransactionSignal(extendedNextContext) && !hasSummaryAmountContext(extendedNextContext)) {
    return withNearbyDateTime(lines, index, extendedNextContext);
  }

  const previous2 = lines[index - 2] ?? "";
  const previousContext = [previous, line].filter(Boolean).join(" ");
  if (hasTransactionSignal(previousContext) && !hasSummaryAmountContext(previousContext)) {
    return withNearbyDateTime(lines, index, previousContext);
  }
  const extendedPreviousContext = [previous2, previous, line].filter(Boolean).join(" ");
  if (!hasAmountSignal(previous) && hasTransactionSignal(extendedPreviousContext) && !hasSummaryAmountContext(extendedPreviousContext)) {
    return withNearbyDateTime(lines, index, extendedPreviousContext);
  }
  return undefined;
}

function candidateBlocks(text: string, sourceMedium: "body" | "attachment"): CandidateBlock[] {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const amountLines = lines
    .map((line, index) => hasAmountSignal(line) ? amountLineBlock(lines, index) : undefined)
    .filter((line): line is string => Boolean(line));
  const compact = text.replace(/\s+/g, " ").trim();
  const blocks = amountLines.length
    ? amountLines
    : (hasAmountSignal(compact) && isLikelyTransactionBlock(compact) && !hasSummaryAmountContext(compact) ? [compact] : []);
  return blocks.map((block) => ({ text: block, sourceMedium }));
}

export function parseCmbCreditCardTransactions(
  message: EmailMessage,
  options: { currency: string },
): CmbCreditCardTransaction[] {
  const text = bodyText(message);
  const blocks = [
    ...candidateBlocks(text, "body"),
    ...attachmentTexts(message).flatMap((attachmentText) => candidateBlocks(attachmentText, "attachment")),
  ];
  const transactions: CmbCreditCardTransaction[] = [];
  const seen = new Set<string>();
  for (const [index, block] of blocks.entries()) {
    if (!isLikelyTransactionBlock(block.text)) continue;
    const amount = findAmount(block.text);
    if (amount === undefined) continue;
    const cardTail = findCardTail(block.text) ?? findCardTail(text);
    const occurredAt = findOccurredAt(block.text, message);
    const txDirection = direction(block.text);
    const merchant = findMerchant(block.text) ?? findMerchant(text);
    const id = hashValue([
      message.message_id_hash,
      index,
      block.sourceMedium,
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
      source_medium: block.sourceMedium,
      source: "cmb-credit-card-email",
    });
  }
  return transactions;
}
