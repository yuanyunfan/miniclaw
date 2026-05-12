import type {
  MarketIntelDataQualitySource,
  MarketIntelEvidenceCollection,
  MarketIntelEvidenceItem,
  MarketIntelEvidenceSection,
  MarketIntelProviderConfig,
  MarketIntelSourceStatus,
  MarketIntelSourceTier,
} from "../types.js";
import { sanitizeMarketIntelError } from "../redaction.js";
import type { PreProviderRunArgs } from "../../types.js";
import {
  addDays,
  dateOnly,
  extractDatedHtmlLinks,
  yyyymmdd,
} from "./parsers/shared.js";
import {
  BLS_SERIES_IDS,
  parseBlsEvidence,
  parseFederalReserveRssEvidence,
  parseTreasuryYieldCurveEvidence,
} from "./parsers/macro.js";
import {
  parseHkexAnnouncements,
  parseJsonp,
  parseSecSubmissionsEvidence,
  parseSecTickerCikMap,
  parseSseAnnouncements,
  parseSzseAnnouncements,
  secTickerCandidates,
} from "./parsers/filings.js";
import { riskKeyword } from "./parsers/risk.js";

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
  const implemented = sources.filter((item) => item.status !== "skipped");
  const status = items.length
    ? failures.length ? "partial" : "ok"
    : implemented.length
      ? failures.length ? "partial" : "empty"
      : sources.length ? "skipped" : "empty";
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
    const items = parseTreasuryYieldCurveEvidence({
      xmlText: await params.http.getText(url),
      runAt: params.args.runAt,
      maxStaleMinutes: params.config.quality.max_stale_minutes.macro,
      url,
    });
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
      seriesid: BLS_SERIES_IDS,
      startyear: String(endYear - 1),
      endyear: String(endYear),
    });
    const items = parseBlsEvidence({ json, runAt: params.args.runAt, url });
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
    const items = parseFederalReserveRssEvidence({
      xmlText: await params.http.getText(url),
      runAt: params.args.runAt,
      maxStaleMinutes: params.config.quality.max_stale_minutes.news,
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
  const tickers = secTickerCandidates(params.config.watchlists.symbols, params.config.sources.earnings.max_items);
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
    const cikByTicker = parseSecTickerCikMap(mapping);

    const items: MarketIntelEvidenceItem[] = [];
    for (const ticker of tickers) {
      const cik = cikByTicker.get(ticker);
      if (cik === undefined) continue;
      const cikPadded = String(cik).padStart(10, "0");
      const submissions = await params.http.getJson(`https://data.sec.gov/submissions/CIK${cikPadded}.json`, { headers });
      items.push(...parseSecSubmissionsEvidence({
        submissions,
        ticker,
        cik,
        cikPadded,
        runAt: params.args.runAt,
        itemOffset: items.length,
        maxItems: params.config.sources.earnings.max_items - items.length,
        maxStaleMinutes: params.config.quality.max_stale_minutes.news,
      }));
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
    const json = parseJsonp(await params.http.getText(url.href, {
      headers: {
        Referer: "https://www.sse.com.cn/",
      },
    }));
    const items = parseSseAnnouncements({
      json,
      runAt: params.args.runAt,
      maxItems: params.config.sources.earnings.max_items,
      maxStaleMinutes: params.config.quality.max_stale_minutes.news,
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

async function collectSzse(params: {
  args: PreProviderRunArgs;
  config: MarketIntelProviderConfig;
  http: MarketIntelOfficialHttpClient;
}): Promise<CollectorResult> {
  if (params.config.sources.earnings.provider !== "exchange_announcements") {
    return skippedResult({
      id: "filing.szse",
      collector: "filings",
      sourceName: params.config.sources.earnings.provider,
      message: "SZSE announcements are not configured as the earnings/filings provider.",
    });
  }
  const beginDate = dateOnly(addDays(params.args.runAt, -7));
  const endDate = dateOnly(params.args.runAt);
  const url = "https://www.szse.cn/api/disc/announcement/annList?random=0.1";
  try {
    const json = await params.http.postJson(url, {
      seDate: [beginDate, endDate],
      channelCode: ["listedNotice_disc"],
      pageSize: Math.min(50, params.config.sources.earnings.max_items),
      pageNum: 1,
    }, {
      headers: {
        Referer: "https://www.szse.cn/disclosure/listed/notice/index.html",
      },
    });
    const items = parseSzseAnnouncements({
      json,
      runAt: params.args.runAt,
      maxItems: params.config.sources.earnings.max_items,
      maxStaleMinutes: params.config.quality.max_stale_minutes.news,
    });
    return {
      items,
      source: source({
        id: "filing.szse",
        collector: "filings",
        source: "exchange_announcements",
        tier: "official",
        status: "ok",
        message: `SZSE announcements fetched: items=${items.length}.`,
      }),
    };
  } catch (err) {
    return failureResult({ id: "filing.szse", collector: "filings", sourceName: "szse_announcements", err });
  }
}

async function collectHkex(params: {
  args: PreProviderRunArgs;
  config: MarketIntelProviderConfig;
  http: MarketIntelOfficialHttpClient;
}): Promise<CollectorResult> {
  if (params.config.sources.earnings.provider !== "exchange_announcements") {
    return skippedResult({
      id: "filing.hkex",
      collector: "filings",
      sourceName: params.config.sources.earnings.provider,
      message: "HKEX announcements are not configured as the earnings/filings provider.",
    });
  }
  const beginDate = yyyymmdd(addDays(params.args.runAt, -7));
  const endDate = yyyymmdd(params.args.runAt);
  const url = new URL("https://www1.hkexnews.hk/search/titlesearch.xhtml");
  url.searchParams.set("lang", "en");
  url.searchParams.set("market", "SEHK");
  url.searchParams.set("searchType", "0");
  url.searchParams.set("documentType", "-1");
  url.searchParams.set("sortByOptions", "DateTime");
  url.searchParams.set("sortDir", "0");
  url.searchParams.set("from", beginDate);
  url.searchParams.set("to", endDate);
  url.searchParams.set("rowRange", String(Math.min(50, params.config.sources.earnings.max_items)));
  try {
    const html = await params.http.getText(url.href, {
      headers: {
        Referer: "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=en",
      },
    });
    const items = parseHkexAnnouncements({
      html,
      runAt: params.args.runAt,
      maxItems: params.config.sources.earnings.max_items,
      maxStaleMinutes: params.config.quality.max_stale_minutes.news,
    });
    return {
      items,
      source: source({
        id: "filing.hkex",
        collector: "filings",
        source: "exchange_announcements",
        tier: "official",
        status: "ok",
        message: `HKEX announcement search fetched: items=${items.length}.`,
      }),
    };
  } catch (err) {
    return failureResult({ id: "filing.hkex", collector: "filings", sourceName: "hkex_announcements", err });
  }
}

function deriveRiskEvidence(params: {
  runAt: Date;
  evidence: MarketIntelEvidenceItem[];
  sources: MarketIntelDataQualitySource[];
}): CollectorResult {
  const items: MarketIntelEvidenceItem[] = [];
  const seen = new Set<string>();
  for (const item of params.evidence) {
    const title = item.title ?? item.summary;
    const riskType = riskKeyword(title);
    if (!riskType || seen.has(riskType)) continue;
    seen.add(riskType);
    items.push({
      id: `risk.derived.${items.length + 1}`,
      category: "risk",
      source: "market-intel derived risk flags",
      source_tier: "local_readonly",
      captured_at: params.runAt.toISOString(),
      title: `${riskType} flagged from official evidence`,
      summary: `Derived ${riskType} from ${item.id}: ${item.summary}`,
      published_at: item.published_at,
      importance: item.importance === "high" ? "high" : "medium",
      freshness: item.freshness,
      freshness_minutes: item.freshness_minutes,
      url: item.url,
      symbols: item.symbols,
      sectors: item.sectors,
    });
    if (items.length >= 8) break;
  }

  const failedSources = params.sources.filter((item) => item.status === "failed" || item.status === "missing_config");
  if (failedSources.length) {
    items.push({
      id: `risk.derived.${items.length + 1}`,
      category: "risk",
      source: "market-intel derived risk flags",
      source_tier: "local_readonly",
      captured_at: params.runAt.toISOString(),
      title: "data_quality_risk flagged from source failures",
      summary: `Official source coverage is degraded: ${failedSources.map((item) => item.id).join(", ")}.`,
      importance: "medium",
      freshness: "fresh",
    });
  }

  return {
    items,
    source: source({
      id: "risk.derived",
      collector: "risk",
      source: "derived_from_official_evidence",
      tier: "local_readonly",
      status: "ok",
      message: `Derived risk flags from official evidence: items=${items.length}.`,
    }),
  };
}

function splitCollection(
  args: PreProviderRunArgs,
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
  const baseEvidence = dedupeEvidence([...macroItems, ...newsItems, ...filingItems]);
  const riskResult = deriveRiskEvidence({ runAt: args.runAt, evidence: baseEvidence, sources });
  const riskItems = riskResult.items;
  const allEvidence = dedupeEvidence([...baseEvidence, ...riskItems]);
  const macroSources = sources.filter((item) => item.collector === "macro" || item.id === "news.federal_reserve");
  const newsSources = sources.filter((item) => item.collector === "news" || item.id === "macro.pboc" || item.id === "macro.nbs");
  const filingSources = sources.filter((item) => item.collector === "filings");
  const riskSources = [riskResult.source];

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
        : "SSE, SZSE, and HKEX official announcement searches are collected where their public endpoints are reachable.",
    ]),
    risks: section(riskItems, riskSources, [
      "Risk flags are deterministically derived from official macro/news/filing evidence and source-failure signals.",
    ]),
    evidence: allEvidence,
    data_quality_sources: [...sources, riskResult.source],
    warnings,
  };
}

export function buildEmptyMarketIntelEvidenceCollection(): MarketIntelEvidenceCollection {
  return {
    macro_policy: emptySection("skipped", "Official macro/policy collector was skipped for this run."),
    news: emptySection("skipped", "Official news collector was skipped for this run."),
    earnings: emptySection("skipped", "Earnings collector was skipped for this run."),
    filings: emptySection("skipped", "Filings collector was skipped for this run."),
    risks: emptySection("skipped", "Risk collector was skipped for this run."),
    evidence: [],
    data_quality_sources: [
      source({
        id: "macro.official",
        collector: "macro",
        source: "official_sources",
        tier: "placeholder",
        status: "skipped",
        message: "Official evidence collector was skipped for this run.",
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
      collectSzse({ ...params, http }),
      collectHkex({ ...params, http }),
    ]);
  return splitCollection(params.args, params.config, sourceResults);
}
