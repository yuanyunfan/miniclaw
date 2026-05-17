import type {
  MarketIntelEvidenceFreshness,
  MarketIntelEvidenceImportance,
  MarketIntelEvidenceItem,
} from "../../../../data/market-intel-types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

export function recordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

export function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (isRecord(value)) return stringValue(value["#text"]) ?? stringValue(value["#cdata"]);
  return undefined;
}

export function numberValue(value: unknown): number | undefined {
  const text = stringValue(value);
  if (!text || text === "-") return undefined;
  const parsed = Number(text.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter((item): item is string => Boolean(item))
    : [];
}

export function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function parseDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function freshness(runAt: Date, publishedAt: string | undefined, maxStaleMinutes: number): {
  freshness?: MarketIntelEvidenceFreshness;
  freshness_minutes?: number;
} {
  const published = parseDate(publishedAt);
  if (published === undefined) return { freshness: "unknown" };
  const minutes = Math.max(0, Math.round((runAt.getTime() - published) / 60_000));
  return {
    freshness: minutes > maxStaleMinutes ? "stale" : "fresh",
    freshness_minutes: minutes,
  };
}

export function decodeHtml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function attr(attrs: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(attrs);
  return match?.[1]?.trim();
}

export function absoluteUrl(baseUrl: string, href: string): string | undefined {
  if (!href || href.startsWith("javascript:") || href.includes("'+")) return undefined;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return undefined;
  }
}

export function importanceFromTitle(title: string): MarketIntelEvidenceImportance {
  return /(FOMC|monetary|rate|Treasury|CPI|PPI|employment|payroll|GDP|PMI|liquidity|open market|reverse repo|statement|inflation|inside information|profit warning|trading halt|resumption|default|investigation|减持|增持|停牌|复牌|业绩预告|风险|问询|监管|处罚)/i
    .test(title)
    ? "high"
    : "medium";
}

export function extractDatedHtmlLinks(params: {
  html: string;
  baseUrl: string;
  idPrefix: string;
  source: string;
  category: MarketIntelEvidenceItem["category"];
  runAt: Date;
  maxItems: number;
  maxStaleMinutes: number;
  importance?: MarketIntelEvidenceImportance;
}): MarketIntelEvidenceItem[] {
  const out: MarketIntelEvidenceItem[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(params.html)) !== null && out.length < params.maxItems) {
    const attrs = match[1] ?? "";
    const href = attr(attrs, "href");
    if (!href) continue;
    const url = absoluteUrl(params.baseUrl, href);
    if (!url || seen.has(url)) continue;
    const tail = params.html.slice(anchorRe.lastIndex, anchorRe.lastIndex + 320);
    const publishedAt = /(\d{4}-\d{2}-\d{2})/.exec(tail)?.[1];
    const title = decodeHtml(attr(attrs, "title") ?? match[2] ?? "");
    if (!title || title.length < 6) continue;
    if (!publishedAt && !/\/20\d{4,}/.test(href)) continue;
    seen.add(url);
    const freshnessInfo = freshness(params.runAt, publishedAt, params.maxStaleMinutes);
    out.push({
      id: `${params.idPrefix}.${out.length + 1}`,
      category: params.category,
      source: params.source,
      source_tier: "official",
      captured_at: params.runAt.toISOString(),
      title,
      summary: `${title}${publishedAt ? ` (${publishedAt})` : ""}`,
      published_at: publishedAt,
      importance: params.importance ?? importanceFromTitle(title),
      ...freshnessInfo,
      url,
    });
  }
  return out;
}

export function yyyymmdd(date: Date): string {
  return dateOnly(date).replace(/-/g, "");
}
