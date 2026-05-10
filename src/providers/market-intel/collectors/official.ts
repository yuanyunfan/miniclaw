import { XMLParser } from "fast-xml-parser";
import type {
  MarketIntelDataQualitySource,
  MarketIntelEvidenceCollection,
  MarketIntelEvidenceFreshness,
  MarketIntelEvidenceImportance,
  MarketIntelEvidenceItem,
  MarketIntelEvidenceSection,
  MarketIntelProviderConfig,
  MarketIntelSourceStatus,
  MarketIntelSourceTier,
} from "../types.js";
import { sanitizeMarketIntelError } from "../redaction.js";
import type { PreProviderRunArgs } from "../../types.js";

export interface MarketIntelOfficialHttpClient {
  getText(url: string, init?: { headers?: Record<string, string> }): Promise<string>;
  getJson(url: string, init?: { headers?: Record<string, string> }): Promise<unknown>;
  postJson(url: string, body: unknown, init?: { headers?: Record<string, string> }): Promise<unknown>;
}

interface CollectorResult {
  items: MarketIntelEvidenceItem[];
  source: MarketIntelDataQualitySource;
  warnings?: string[];
}

const DEFAULT_TIMEOUT_MS = 10_000;
const SEC_USER_AGENT = process.env.MINICLAW_SEC_USER_AGENT ?? "MiniClaw/0.4 market-intel yuan@example.invalid";
const XML = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  cdataPropName: "#cdata",
  textNodeName: "#text",
  trimValues: true,
  parseAttributeValue: false,
  parseTagValue: false,
});

const BLS_SERIES = [
  { id: "CUUR0000SA0", name: "CPI-U all items", importance: "high" as const },
  { id: "LNS14000000", name: "Unemployment rate", importance: "high" as const },
  { id: "CES0000000001", name: "Nonfarm payroll employment", importance: "medium" as const },
];

const SEC_FORMS = new Set(["8-K", "10-Q", "10-K", "20-F", "6-K"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function recordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (isRecord(value)) return stringValue(value["#text"]) ?? stringValue(value["#cdata"]);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  const text = stringValue(value);
  if (!text || text === "-") return undefined;
  const parsed = Number(text.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter((item): item is string => Boolean(item))
    : [];
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function parseDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function freshness(runAt: Date, publishedAt: string | undefined, maxStaleMinutes: number): {
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

function source(params: {
  id: string;
  collector: string;
  source: string;
  tier: MarketIntelSourceTier;
  status: MarketIntelSourceStatus;
  message?: string;
}): MarketIntelDataQualitySource {
  return params;
}

function section(
  items: MarketIntelEvidenceItem[],
  sources: MarketIntelDataQualitySource[],
  notes: string[],
): MarketIntelEvidenceSection {
  const failures = sources.filter((item) => item.status === "failed" || item.status === "missing_config");
  const implemented = sources.filter((item) => item.status !== "not_implemented" && item.status !== "skipped");
  const status = items.length
    ? failures.length ? "partial" : "ok"
    : implemented.length
      ? failures.length ? "partial" : "empty"
      : sources.length ? "skipped" : "not_implemented";
  return { status, items, notes };
}

function emptySection(status: MarketIntelEvidenceSection["status"], note: string): MarketIntelEvidenceSection {
  return { status, items: [], notes: [note] };
}

function dedupeEvidence(items: MarketIntelEvidenceItem[]): MarketIntelEvidenceItem[] {
  const seen = new Set<string>();
  const out: MarketIntelEvidenceItem[] = [];
  for (const item of items) {
    const key = item.url ? `${item.id}:${item.url}` : item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function decodeHtml(value: string): string {
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

function attr(attrs: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(attrs);
  return match?.[1]?.trim();
}

function absoluteUrl(baseUrl: string, href: string): string | undefined {
  if (!href || href.startsWith("javascript:") || href.includes("'+")) return undefined;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return undefined;
  }
}

function extractDatedHtmlLinks(params: {
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

function importanceFromTitle(title: string): MarketIntelEvidenceImportance {
  return /(FOMC|monetary|rate|Treasury|CPI|PPI|employment|payroll|GDP|PMI|liquidity|open market|reverse repo|statement|inflation)/i
    .test(title)
    ? "high"
    : "medium";
}

class FetchMarketIntelOfficialHttpClient implements MarketIntelOfficialHttpClient {
  async getText(url: string, init: { headers?: Record<string, string> } = {}): Promise<string> {
    const res = await this.request(url, { method: "GET", headers: init.headers });
    return await res.text();
  }

  async getJson(url: string, init: { headers?: Record<string, string> } = {}): Promise<unknown> {
    const res = await this.request(url, { method: "GET", headers: init.headers });
    return await res.json() as unknown;
  }

  async postJson(url: string, body: unknown, init: { headers?: Record<string, string> } = {}): Promise<unknown> {
    const res = await this.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...init.headers },
      body: JSON.stringify(body),
    });
    return await res.json() as unknown;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ac.signal,
        headers: {
          "User-Agent": "MiniClaw/0.4 market-intel",
          ...(init.headers as Record<string, string> | undefined),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } finally {
      clearTimeout(timer);
    }
  }
}

function failureResult(params: {
  id: string;
  collector: string;
  sourceName: string;
  tier?: MarketIntelSourceTier;
  err: unknown;
}): CollectorResult {
  const message = sanitizeMarketIntelError(params.err);
  return {
    items: [],
    source: source({
      id: params.id,
      collector: params.collector,
      source: params.sourceName,
      tier: params.tier ?? "official",
      status: "failed",
      message,
    }),
    warnings: [`${params.collector}: ${params.sourceName} failed: ${message}`],
  };
}

function skippedResult(params: {
  id: string;
  collector: string;
  sourceName: string;
  tier?: MarketIntelSourceTier;
  message: string;
}): CollectorResult {
  return {
    items: [],
    source: source({
      id: params.id,
      collector: params.collector,
      source: params.sourceName,
      tier: params.tier ?? "official",
      status: "skipped",
      message: params.message,
    }),
  };
}

async function collectTreasury(params: {
  args: PreProviderRunArgs;
  config: MarketIntelProviderConfig;
  http: MarketIntelOfficialHttpClient;
}): Promise<CollectorResult> {
  if (!params.config.sources.macro.treasury) {
    return skippedResult({
      id: "macro.treasury",
      collector: "macro",
      sourceName: "treasury",
      message: "Treasury macro source is not configured.",
    });
  }
  const year = params.args.runAt.getUTCFullYear();
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
  try {
    const parsed = XML.parse(await params.http.getText(url));
    const entries = asArray(recordValue(recordValue(parsed, "feed"), "entry"));
    const rows = entries
      .map((entry) => {
        const props = recordValue(recordValue(entry, "content"), "m:properties");
        const publishedAt = stringValue(recordValue(props, "d:NEW_DATE"))?.slice(0, 10);
        return {
          publishedAt,
          twoYear: numberValue(recordValue(props, "d:BC_2YEAR")),
          tenYear: numberValue(recordValue(props, "d:BC_10YEAR")),
          thirtyYear: numberValue(recordValue(props, "d:BC_30YEAR")),
        };
      })
      .filter((row) => row.publishedAt && parseDate(row.publishedAt) !== undefined)
      .sort((a, b) => (parseDate(b.publishedAt) ?? 0) - (parseDate(a.publishedAt) ?? 0));
    const runDate = dateOnly(params.args.runAt);
    const row = rows.find((item) => item.publishedAt !== undefined && item.publishedAt <= runDate) ?? rows[0];
    const items: MarketIntelEvidenceItem[] = row
      ? [{
        id: "macro.treasury.yield_curve.1",
        category: "macro",
        source: "U.S. Treasury daily treasury yield curve",
        source_tier: "official",
        captured_at: params.args.runAt.toISOString(),
        title: "U.S. Treasury yield curve",
        summary: `Treasury yield curve ${row.publishedAt}: 2Y=${row.twoYear ?? "n/a"}%, 10Y=${row.tenYear ?? "n/a"}%, 30Y=${row.thirtyYear ?? "n/a"}%.`,
        published_at: row.publishedAt,
        importance: "high",
        ...freshness(params.args.runAt, row.publishedAt, params.config.quality.max_stale_minutes.macro),
        url,
      }]
      : [];
    return {
      items,
      source: source({
        id: "macro.treasury",
        collector: "macro",
        source: "official_xml_or_fiscaldata",
        tier: "official",
        status: "ok",
        message: `Treasury yield curve fetched: items=${items.length}.`,
      }),
    };
  } catch (err) {
    return failureResult({ id: "macro.treasury", collector: "macro", sourceName: "treasury", err });
  }
}

async function collectBls(params: {
  args: PreProviderRunArgs;
  config: MarketIntelProviderConfig;
  http: MarketIntelOfficialHttpClient;
}): Promise<CollectorResult> {
  if (!params.config.sources.macro.bls) {
    return skippedResult({
      id: "macro.bls",
      collector: "macro",
      sourceName: "bls_public_api",
      message: "BLS macro source is not configured.",
    });
  }
  const endYear = params.args.runAt.getUTCFullYear();
  const url = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
  try {
    const json = await params.http.postJson(url, {
      seriesid: BLS_SERIES.map((item) => item.id),
      startyear: String(endYear - 1),
      endyear: String(endYear),
    });
    const seriesRows = asArray(recordValue(recordValue(json, "Results"), "series"));
    const items = BLS_SERIES.flatMap((series, index): MarketIntelEvidenceItem[] => {
      const row = seriesRows.find((item) => recordValue(item, "seriesID") === series.id);
      const data = asArray(recordValue(row, "data"));
      const latest = data.find((item) => stringValue(recordValue(item, "value")) && stringValue(recordValue(item, "value")) !== "-");
      if (!latest) return [];
      const year = stringValue(recordValue(latest, "year"));
      const periodName = stringValue(recordValue(latest, "periodName"));
      const value = stringValue(recordValue(latest, "value"));
      const publishedAt = year && periodName ? `${periodName} ${year}` : undefined;
      return [{
        id: `macro.bls.${index + 1}`,
        category: "macro",
        source: "BLS Public Data API",
        source_tier: "official",
        captured_at: params.args.runAt.toISOString(),
        title: `${series.name} latest value`,
        summary: `${series.name}: ${value ?? "n/a"}${publishedAt ? ` for ${publishedAt}` : ""}.`,
        published_at: publishedAt,
        importance: series.importance,
        freshness: "unknown",
        url,
      }];
    });
    return {
      items,
      source: source({
        id: "macro.bls",
        collector: "macro",
        source: "official_public_api",
        tier: "official",
        status: "ok",
        message: `BLS public API fetched: items=${items.length}.`,
      }),
    };
  } catch (err) {
    return failureResult({ id: "macro.bls", collector: "macro", sourceName: "bls_public_api", err });
  }
}

async function collectFed(params: {
  args: PreProviderRunArgs;
  config: MarketIntelProviderConfig;
  http: MarketIntelOfficialHttpClient;
}): Promise<CollectorResult> {
  if (!params.config.sources.macro.federal_reserve) {
    return skippedResult({
      id: "macro.federal_reserve",
      collector: "news",
      sourceName: "federal_reserve",
      message: "Federal Reserve macro/news source is not configured.",
    });
  }
  const url = "https://www.federalreserve.gov/feeds/press_all.xml";
  try {
    const parsed = XML.parse(await params.http.getText(url));
    const channel = recordValue(recordValue(parsed, "rss"), "channel");
    const entries = asArray(recordValue(channel, "item")).slice(0, 8);
    const items = entries.flatMap((entry, index): MarketIntelEvidenceItem[] => {
      const title = decodeHtml(stringValue(recordValue(entry, "title")) ?? "");
      if (!title) return [];
      const publishedAt = stringValue(recordValue(entry, "pubDate"));
      return [{
        id: `news.federal_reserve.${index + 1}`,
        category: "news",
        source: "Federal Reserve press RSS",
        source_tier: "official",
        captured_at: params.args.runAt.toISOString(),
        title,
        summary: `${title}${publishedAt ? ` (${publishedAt})` : ""}`,
        published_at: publishedAt,
        importance: importanceFromTitle(title),
        ...freshness(params.args.runAt, publishedAt, params.config.quality.max_stale_minutes.news),
        url: stringValue(recordValue(entry, "link")),
      }];
    });
    return {
      items,
      source: source({
        id: "news.federal_reserve",
        collector: "news",
        source: "official_html_rss",
        tier: "official",
        status: "ok",
        message: `Federal Reserve RSS fetched: items=${items.length}.`,
      }),
    };
  } catch (err) {
    return failureResult({ id: "news.federal_reserve", collector: "news", sourceName: "federal_reserve", err });
  }
}

function tickerCandidates(config: MarketIntelProviderConfig): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const symbol of config.watchlists.symbols) {
    const normalized = symbol.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out.slice(0, Math.min(10, config.sources.earnings.max_items));
}

async function collectSec(params: {
  args: PreProviderRunArgs;
  config: MarketIntelProviderConfig;
  http: MarketIntelOfficialHttpClient;
}): Promise<CollectorResult> {
  if (params.config.sources.earnings.provider !== "sec_edgar") {
    return skippedResult({
      id: "filing.sec",
      collector: "filings",
      sourceName: params.config.sources.earnings.provider,
      message: "SEC EDGAR is not configured as the earnings/filings provider.",
    });
  }
  const tickers = tickerCandidates(params.config);
  if (!tickers.length) {
    return skippedResult({
      id: "filing.sec",
      collector: "filings",
      sourceName: "sec_edgar",
      message: "No US stock symbols are configured for SEC filing lookup.",
    });
  }
  try {
    const headers = { "User-Agent": SEC_USER_AGENT };
    const mapping = await params.http.getJson("https://www.sec.gov/files/company_tickers_exchange.json", { headers });
    const mappingRows = asArray(recordValue(mapping, "data"));
    const cikByTicker = new Map<string, number>();
    for (const row of mappingRows) {
      if (!Array.isArray(row)) continue;
      const cik = numberValue(row[0]);
      const ticker = stringValue(row[2])?.toUpperCase();
      if (cik !== undefined && ticker) cikByTicker.set(ticker, cik);
    }

    const items: MarketIntelEvidenceItem[] = [];
    for (const ticker of tickers) {
      const cik = cikByTicker.get(ticker);
      if (cik === undefined) continue;
      const cikPadded = String(cik).padStart(10, "0");
      const submissions = await params.http.getJson(`https://data.sec.gov/submissions/CIK${cikPadded}.json`, { headers });
      const recent = recordValue(recordValue(submissions, "filings"), "recent");
      const forms = stringArray(recordValue(recent, "form"));
      const dates = stringArray(recordValue(recent, "filingDate"));
      const accessions = stringArray(recordValue(recent, "accessionNumber"));
      const documents = stringArray(recordValue(recent, "primaryDocument"));
      for (let i = 0; i < forms.length && items.length < params.config.sources.earnings.max_items; i += 1) {
        const form = forms[i];
        if (!form || !SEC_FORMS.has(form)) continue;
        const accession = accessions[i];
        const document = documents[i];
        const publishedAt = dates[i];
        const cikNoLeading = String(cik).replace(/^0+/, "");
        const url = accession && document
          ? `https://www.sec.gov/Archives/edgar/data/${cikNoLeading}/${accession.replace(/-/g, "")}/${document}`
          : `https://data.sec.gov/submissions/CIK${cikPadded}.json`;
        items.push({
          id: `filing.sec.${ticker.toLowerCase()}.${items.length + 1}`,
          category: "filing",
          source: "SEC EDGAR submissions API",
          source_tier: "official",
          captured_at: params.args.runAt.toISOString(),
          title: `${ticker} ${form} filing`,
          summary: `${ticker} filed ${form}${publishedAt ? ` on ${publishedAt}` : ""}.`,
          published_at: publishedAt,
          importance: form === "8-K" ? "high" : "medium",
          ...freshness(params.args.runAt, publishedAt, params.config.quality.max_stale_minutes.news),
          url,
          symbols: [ticker],
        });
      }
    }
    return {
      items,
      source: source({
        id: "filing.sec",
        collector: "filings",
        source: "sec_edgar",
        tier: "official",
        status: "ok",
        message: `SEC EDGAR fetched: tickers=${tickers.length}, items=${items.length}.`,
      }),
    };
  } catch (err) {
    return failureResult({ id: "filing.sec", collector: "filings", sourceName: "sec_edgar", err });
  }
}

async function collectPbc(params: {
  args: PreProviderRunArgs;
  config: MarketIntelProviderConfig;
  http: MarketIntelOfficialHttpClient;
}): Promise<CollectorResult> {
  if (!params.config.sources.macro.pboc) {
    return skippedResult({
      id: "macro.pboc",
      collector: "macro",
      sourceName: "pboc",
      message: "PBOC macro source is not configured.",
    });
  }
  const url = "http://www.pbc.gov.cn/zhengcehuobisi/125207/125213/125431/125475/index.html";
  try {
    const items = extractDatedHtmlLinks({
      html: await params.http.getText(url),
      baseUrl: url,
      idPrefix: "macro.pboc.omo",
      source: "PBOC open market operations page",
      category: "macro",
      runAt: params.args.runAt,
      maxItems: 8,
      maxStaleMinutes: params.config.quality.max_stale_minutes.macro,
      importance: "high",
    });
    return {
      items,
      source: source({
        id: "macro.pboc",
        collector: "macro",
        source: "official_html",
        tier: "official",
        status: "ok",
        message: `PBOC open market operations page fetched: items=${items.length}.`,
      }),
    };
  } catch (err) {
    return failureResult({ id: "macro.pboc", collector: "macro", sourceName: "pboc", err });
  }
}

async function collectNbs(params: {
  args: PreProviderRunArgs;
  config: MarketIntelProviderConfig;
  http: MarketIntelOfficialHttpClient;
}): Promise<CollectorResult> {
  if (!params.config.sources.macro.nbs) {
    return skippedResult({
      id: "macro.nbs",
      collector: "macro",
      sourceName: "nbs",
      message: "NBS macro source is not configured.",
    });
  }
  const url = "https://www.stats.gov.cn/english/PressRelease/";
  try {
    const items = extractDatedHtmlLinks({
      html: await params.http.getText(url),
      baseUrl: url,
      idPrefix: "macro.nbs.release",
      source: "NBS latest releases page",
      category: "macro",
      runAt: params.args.runAt,
      maxItems: 12,
      maxStaleMinutes: params.config.quality.max_stale_minutes.macro,
    });
    return {
      items,
      source: source({
        id: "macro.nbs",
        collector: "macro",
        source: "official_html",
        tier: "official",
        status: "ok",
        message: `NBS latest releases page fetched: items=${items.length}.`,
      }),
    };
  } catch (err) {
    return failureResult({ id: "macro.nbs", collector: "macro", sourceName: "nbs", err });
  }
}

function jsonFromJsonp(value: string): unknown {
  const match = /^[^(]*\(([\s\S]*)\)\s*;?\s*$/.exec(value.trim());
  if (!match) return JSON.parse(value) as unknown;
  return JSON.parse(match[1] ?? "{}") as unknown;
}

async function collectSse(params: {
  args: PreProviderRunArgs;
  config: MarketIntelProviderConfig;
  http: MarketIntelOfficialHttpClient;
}): Promise<CollectorResult> {
  if (params.config.sources.earnings.provider !== "exchange_announcements") {
    return skippedResult({
      id: "filing.sse",
      collector: "filings",
      sourceName: params.config.sources.earnings.provider,
      message: "SSE announcements are not configured as the earnings/filings provider.",
    });
  }
  const endDate = dateOnly(params.args.runAt);
  const beginDate = dateOnly(addDays(params.args.runAt, -7));
  const url = new URL("https://query.sse.com.cn/security/stock/queryCompanyBulletin.do");
  url.searchParams.set("jsonCallBack", "jsonpCallback");
  url.searchParams.set("isPagination", "true");
  url.searchParams.set("pageHelp.pageSize", String(Math.min(25, params.config.sources.earnings.max_items)));
  url.searchParams.set("pageHelp.pageNo", "1");
  url.searchParams.set("pageHelp.beginPage", "1");
  url.searchParams.set("pageHelp.cacheSize", "1");
  url.searchParams.set("securityType", "0101,120100,020100,020200,120200");
  url.searchParams.set("reportType", "ALL");
  url.searchParams.set("beginDate", beginDate);
  url.searchParams.set("endDate", endDate);
  try {
    const json = jsonFromJsonp(await params.http.getText(url.href, {
      headers: {
        Referer: "https://www.sse.com.cn/",
      },
    }));
    const rows = asArray(recordValue(recordValue(json, "pageHelp"), "data"));
    const items = rows.slice(0, params.config.sources.earnings.max_items).flatMap((row, index): MarketIntelEvidenceItem[] => {
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
        captured_at: params.args.runAt.toISOString(),
        title,
        summary: `${symbol ?? "SSE"}${name ? ` ${name}` : ""}: ${title}${publishedAt ? ` (${publishedAt})` : ""}`,
        published_at: publishedAt,
        importance: importanceFromTitle(title),
        ...freshness(params.args.runAt, publishedAt, params.config.quality.max_stale_minutes.news),
        url: docUrl,
        symbols: symbol ? [symbol] : undefined,
      }];
    });
    return {
      items,
      source: source({
        id: "filing.sse",
        collector: "filings",
        source: "exchange_announcements",
        tier: "official",
        status: "ok",
        message: `SSE announcements fetched: items=${items.length}.`,
      }),
    };
  } catch (err) {
    return failureResult({ id: "filing.sse", collector: "filings", sourceName: "sse_announcements", err });
  }
}

function splitCollection(
  config: MarketIntelProviderConfig,
  results: CollectorResult[],
): MarketIntelEvidenceCollection {
  const sources = results.map((item) => item.source);
  const warnings = results.flatMap((item) => item.warnings ?? []);
  const macroItems = results
    .filter((item) => item.source.collector === "macro" || item.source.id === "news.federal_reserve")
    .flatMap((item) => item.items);
  const newsItems = results
    .filter((item) => item.source.collector === "news" || item.source.id === "macro.pboc" || item.source.id === "macro.nbs")
    .flatMap((item) => item.items);
  const filingItems = results
    .filter((item) => item.source.collector === "filings")
    .flatMap((item) => item.items);
  const earningsItems = filingItems.filter((item) => item.importance === "high" || /10-[QK]|8-K|earnings|annual|quarter/i.test(item.summary));
  const allEvidence = dedupeEvidence([...macroItems, ...newsItems, ...filingItems]);
  const macroSources = sources.filter((item) => item.collector === "macro" || item.id === "news.federal_reserve");
  const newsSources = sources.filter((item) => item.collector === "news" || item.id === "macro.pboc" || item.id === "macro.nbs");
  const filingSources = sources.filter((item) => item.collector === "filings");

  return {
    macro_policy: section(macroItems, macroSources, [
      "Official macro/policy sources only. Missing or failed sources are listed in data_quality.",
    ]),
    news: section(newsItems, newsSources, [
      "Generic web search is disabled for structured news. This section includes official RSS/page headlines only.",
    ]),
    earnings: section(earningsItems, filingSources, [
      "No standalone earnings calendar source is enabled. Official filings/announcements are used as catalyst evidence.",
    ]),
    filings: section(filingItems, filingSources, [
      config.market_scope === "us"
        ? "SEC EDGAR submissions are collected for configured US stock symbols only."
        : "SSE announcements are collected as the first CN exchange announcement source; HKEX/SZSE are not yet implemented.",
    ]),
    risks: emptySection("not_implemented", "Risk flags will be derived after macro/news/filings coverage stabilizes."),
    evidence: allEvidence,
    data_quality_sources: sources,
    warnings,
  };
}

export function buildEmptyMarketIntelEvidenceCollection(): MarketIntelEvidenceCollection {
  return {
    macro_policy: emptySection("not_implemented", "Official macro/policy collector was not run."),
    news: emptySection("not_implemented", "Official news collector was not run."),
    earnings: emptySection("not_implemented", "Earnings collector was not run."),
    filings: emptySection("not_implemented", "Filings collector was not run."),
    risks: emptySection("not_implemented", "Risk collector was not run."),
    evidence: [],
    data_quality_sources: [
      source({
        id: "macro.official",
        collector: "macro",
        source: "official_sources",
        tier: "placeholder",
        status: "not_implemented",
        message: "Official evidence collector was not run.",
      }),
    ],
    warnings: [],
  };
}

export async function collectMarketIntelOfficialEvidence(
  params: {
    args: PreProviderRunArgs;
    config: MarketIntelProviderConfig;
  },
  deps: { http?: MarketIntelOfficialHttpClient } = {},
): Promise<MarketIntelEvidenceCollection> {
  const http = deps.http ?? new FetchMarketIntelOfficialHttpClient();
  const sourceResults = params.config.market_scope === "us"
    ? await Promise.all([
      collectTreasury({ ...params, http }),
      collectBls({ ...params, http }),
      collectFed({ ...params, http }),
      collectSec({ ...params, http }),
    ])
    : await Promise.all([
      collectPbc({ ...params, http }),
      collectNbs({ ...params, http }),
      collectSse({ ...params, http }),
      skippedResult({
        id: "filing.hkex",
        collector: "filings",
        sourceName: "hkex_announcements",
        message: "HKEX announcement search endpoint is not yet implemented in market-intel.",
      }),
    ]);
  return splitCollection(params.config, sourceResults);
}
