import {
  addDays,
  dateOnly,
  yyyymmdd,
} from "./parsers/shared.js";
import {
  parseHkexAnnouncements,
  parseJsonp,
  parseSecSubmissionsEvidence,
  parseSecTickerCikMap,
  parseSseAnnouncements,
  parseSzseAnnouncements,
  secTickerCandidates,
} from "./parsers/filings.js";
import type { CollectorResult, OfficialCollectorParams } from "./official-shared.js";
import { failureResult, skippedResult, source } from "./official-shared.js";
import type { MarketIntelEvidenceItem } from "../../../../providers/market-intel/types.js";

const SEC_USER_AGENT = process.env.MINICLAW_SEC_USER_AGENT ?? "MiniClaw/0.4 market-intel yuan@example.invalid";

export async function collectOfficialEventEvidence(params: OfficialCollectorParams): Promise<CollectorResult[]> {
  return params.config.market_scope === "us"
    ? await Promise.all([collectSec(params)])
    : await Promise.all([
      collectSse(params),
      collectSzse(params),
      collectHkex(params),
    ]);
}

async function collectSec(params: OfficialCollectorParams): Promise<CollectorResult> {
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

async function collectSse(params: OfficialCollectorParams): Promise<CollectorResult> {
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

async function collectSzse(params: OfficialCollectorParams): Promise<CollectorResult> {
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

async function collectHkex(params: OfficialCollectorParams): Promise<CollectorResult> {
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
