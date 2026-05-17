import type { MarketIntelEvidenceItem } from "../../../../data/market-intel-types.js";
import {
  absoluteUrl,
  asArray,
  attr,
  decodeHtml,
  freshness,
  importanceFromTitle,
  numberValue,
  recordValue,
  stringArray,
  stringValue,
} from "./shared.js";

const SEC_FORMS = new Set(["8-K", "10-Q", "10-K", "20-F", "6-K"]);

export function secTickerCandidates(symbols: string[], maxItems: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const symbol of symbols) {
    const normalized = symbol.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out.slice(0, Math.min(10, maxItems));
}

export function parseSecTickerCikMap(mapping: unknown): Map<string, number> {
  const rows = asArray(recordValue(mapping, "data"));
  const cikByTicker = new Map<string, number>();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const cik = numberValue(row[0]);
    const ticker = stringValue(row[2])?.toUpperCase();
    if (cik !== undefined && ticker) cikByTicker.set(ticker, cik);
  }
  return cikByTicker;
}

export function parseSecSubmissionsEvidence(params: {
  submissions: unknown;
  ticker: string;
  cik: number;
  cikPadded: string;
  runAt: Date;
  itemOffset: number;
  maxItems: number;
  maxStaleMinutes: number;
}): MarketIntelEvidenceItem[] {
  const recent = recordValue(recordValue(params.submissions, "filings"), "recent");
  const forms = stringArray(recordValue(recent, "form"));
  const dates = stringArray(recordValue(recent, "filingDate"));
  const accessions = stringArray(recordValue(recent, "accessionNumber"));
  const documents = stringArray(recordValue(recent, "primaryDocument"));
  const items: MarketIntelEvidenceItem[] = [];
  for (let i = 0; i < forms.length && items.length < params.maxItems; i += 1) {
    const form = forms[i];
    if (!form || !SEC_FORMS.has(form)) continue;
    const accession = accessions[i];
    const document = documents[i];
    const publishedAt = dates[i];
    const cikNoLeading = String(params.cik).replace(/^0+/, "");
    const url = accession && document
      ? `https://www.sec.gov/Archives/edgar/data/${cikNoLeading}/${accession.replace(/-/g, "")}/${document}`
      : `https://data.sec.gov/submissions/CIK${params.cikPadded}.json`;
    items.push({
      id: `filing.sec.${params.ticker.toLowerCase()}.${params.itemOffset + items.length + 1}`,
      category: "filing",
      source: "SEC EDGAR submissions API",
      source_tier: "official",
      captured_at: params.runAt.toISOString(),
      title: `${params.ticker} ${form} filing`,
      summary: `${params.ticker} filed ${form}${publishedAt ? ` on ${publishedAt}` : ""}.`,
      published_at: publishedAt,
      importance: form === "8-K" ? "high" : "medium",
      ...freshness(params.runAt, publishedAt, params.maxStaleMinutes),
      url,
      symbols: [params.ticker],
    });
  }
  return items;
}

export function parseJsonp(value: string): unknown {
  const match = /^[^(]*\(([\s\S]*)\)\s*;?\s*$/.exec(value.trim());
  if (!match) return JSON.parse(value) as unknown;
  return JSON.parse(match[1] ?? "{}") as unknown;
}

export function parseSseAnnouncements(params: {
  json: unknown;
  runAt: Date;
  maxItems: number;
  maxStaleMinutes: number;
}): MarketIntelEvidenceItem[] {
  const rows = asArray(recordValue(recordValue(params.json, "pageHelp"), "data"));
  return rows.slice(0, params.maxItems).flatMap((row, index): MarketIntelEvidenceItem[] => {
    const title = decodeHtml(stringValue(recordValue(row, "TITLE")) ?? "");
    if (!title) return [];
    const symbol = stringValue(recordValue(row, "SECURITY_CODE"));
    const name = stringValue(recordValue(row, "SECURITY_NAME"));
    const publishedAt = stringValue(recordValue(row, "SSEDATE"));
    const docUrl = absoluteUrl("https://www.sse.com.cn/", stringValue(recordValue(row, "URL")) ?? "");
    return [{
      id: `filing.sse.${index + 1}`,
      category: "filing",
      source: "SSE listed company announcements",
      source_tier: "official",
      captured_at: params.runAt.toISOString(),
      title,
      summary: `${symbol ?? "SSE"}${name ? ` ${name}` : ""}: ${title}${publishedAt ? ` (${publishedAt})` : ""}`,
      published_at: publishedAt,
      importance: importanceFromTitle(title),
      ...freshness(params.runAt, publishedAt, params.maxStaleMinutes),
      url: docUrl,
      symbols: symbol ? [symbol] : undefined,
    }];
  });
}

export function parseSzseAnnouncements(params: {
  json: unknown;
  runAt: Date;
  maxItems: number;
  maxStaleMinutes: number;
}): MarketIntelEvidenceItem[] {
  const rows = asArray(recordValue(params.json, "data"));
  return rows
    .flatMap((row, index): MarketIntelEvidenceItem[] => {
      const title = decodeHtml(stringValue(recordValue(row, "title")) ?? "");
      if (!title || exchangeAnnouncementIsLowSignal(title)) return [];
      const symbols = stringArray(recordValue(row, "secCode"));
      const names = stringArray(recordValue(row, "secName"));
      const publishedAt = stringValue(recordValue(row, "publishTime"));
      const attachPath = stringValue(recordValue(row, "attachPath"));
      const url = attachPath ? absoluteUrl("https://disc.static.szse.cn/", attachPath) : undefined;
      return [{
        id: `filing.szse.${index + 1}`,
        category: "filing",
        source: "SZSE listed company announcements",
        source_tier: "official",
        captured_at: params.runAt.toISOString(),
        title,
        summary: `${symbols.join(", ") || "SZSE"}${names.length ? ` ${names.join(", ")}` : ""}: ${title}${publishedAt ? ` (${publishedAt})` : ""}`,
        published_at: publishedAt,
        importance: exchangeAnnouncementIsCatalyst(title) ? "high" : importanceFromTitle(title),
        ...freshness(params.runAt, publishedAt, params.maxStaleMinutes),
        url,
        symbols: symbols.length ? symbols : undefined,
      }];
    })
    .slice(0, params.maxItems);
}

export function parseHkexAnnouncements(params: {
  html: string;
  runAt: Date;
  maxItems: number;
  maxStaleMinutes: number;
}): MarketIntelEvidenceItem[] {
  const rows = [...params.html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1] ?? "");
  return rows
    .flatMap((row, index): MarketIntelEvidenceItem[] => {
      const linkMatch = /<div\b[^>]*class=["'][^"']*doc-link[^"']*["'][^>]*>[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(row);
      if (!linkMatch) return [];
      const href = attr(linkMatch[1] ?? "", "href");
      const title = decodeHtml(linkMatch[2] ?? "");
      if (!href || !title || exchangeAnnouncementIsLowSignal(title)) return [];
      const publishedAt = hkexPublishedAt(cleanCellText(cellByClass(row, "release-time") ?? ""));
      const stockCodeText = cleanCellText(cellByClass(row, "stock-short-code") ?? "");
      const nameText = cleanCellText(cellByClass(row, "stock-short-name") ?? "");
      const symbols = stockCodeText
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean);
      return [{
        id: `filing.hkex.${index + 1}`,
        category: "filing",
        source: "HKEXnews listed company announcements",
        source_tier: "official",
        captured_at: params.runAt.toISOString(),
        title,
        summary: `${stockCodeText || "HKEX"}${nameText ? ` ${nameText}` : ""}: ${title}${publishedAt ? ` (${publishedAt})` : ""}`,
        published_at: publishedAt,
        importance: exchangeAnnouncementIsCatalyst(title) ? "high" : importanceFromTitle(title),
        ...freshness(params.runAt, publishedAt, params.maxStaleMinutes),
        url: absoluteUrl("https://www1.hkexnews.hk/", href),
        symbols: symbols.length ? symbols : undefined,
      }];
    })
    .slice(0, params.maxItems);
}

function hkexPublishedAt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/.exec(value);
  if (!match) return value;
  const [, day, month, year, hour, minute] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:00+08:00`;
}

function cleanCellText(html: string): string {
  return decodeHtml(html)
    .replace(/^Release Time:\s*/i, "")
    .replace(/^Stock Code:\s*/i, "")
    .replace(/^Stock Short Name:\s*/i, "")
    .trim();
}

function cellByClass(rowHtml: string, className: string): string | undefined {
  const re = new RegExp(`<td\\b[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`, "i");
  const match = re.exec(rowHtml);
  return match?.[1];
}

function exchangeAnnouncementIsLowSignal(title: string): boolean {
  return /(Mandatory Call Payoff|Residual Value|Callable Bull\/Bear|Callable Bull|Bear Contract|Derivative Warrant|Inline Warrant|Base Listing Document|Supplemental Listing Document|Launch Announcement|Liquidity Provider|Stabilising Action|Monthly Return|Next Day Disclosure Return)/i
    .test(title);
}

function exchangeAnnouncementIsCatalyst(title: string): boolean {
  return /(inside information|profit warning|profit alert|results|annual report|interim report|quarterly|trading halt|resumption|discloseable transaction|connected transaction|acquisition|disposal|placing|subscription|rights issue|share repurchase|dividend|default|investigation|lawsuit|业绩|年度报告|季度报告|半年度报告|权益变动|增持|减持|停牌|复牌|问询|监管|处罚|重大|风险|回购|分红|诉讼|仲裁|担保|重组|并购)/i
    .test(title);
}
