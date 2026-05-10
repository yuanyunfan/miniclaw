import { describe, expect, it } from "vitest";
import {
  collectMarketIntelOfficialEvidence,
  type MarketIntelOfficialHttpClient,
} from "../collectors/official.js";
import type { MarketIntelProviderConfig } from "../types.js";

function usConfig(overrides: Partial<MarketIntelProviderConfig> = {}): MarketIntelProviderConfig {
  return {
    market_scope: "us",
    session: "pre_market",
    timezone: "America/New_York",
    calendar: {
      provider: "static_plus_remote",
      holidays: [],
      early_closes: [],
      fail_on_unknown_trade_date: false,
      skip_closed_market: true,
    },
    markets: {
      us: {
        timezone: "America/New_York",
        sessions: [{ start: "09:30", end: "16:00" }],
        holidays: [],
        early_closes: [],
      },
    },
    sources: {
      quotes: {
        us_primary: "futu_opend",
        fallback: ["yahoo_chart_unofficial"],
        optional_paid: [],
      },
      macro: {
        federal_reserve: "official_html_rss",
        treasury: "official_xml_or_fiscaldata",
        bls: "official_public_api",
      },
      news: { provider: "official_first_web_fallback", max_items: 40 },
      earnings: { provider: "sec_edgar", max_items: 40 },
      sectors: { provider: "sector_etf" },
    },
    watchlists: {
      indices: ["SPY"],
      sectors: ["XLK"],
      macro: ["DXY"],
      cross_market: [],
      symbols: ["AAPL"],
    },
    quality: {
      max_stale_minutes: { quote: 20, news: 720, macro: 10080 },
      fail_if_all_quotes_fail: true,
      allow_partial_news: true,
    },
    ...overrides,
  };
}

function cnConfig(): MarketIntelProviderConfig {
  return {
    ...usConfig(),
    market_scope: "cn",
    timezone: "Asia/Shanghai",
    markets: {
      "cn-a": {
        timezone: "Asia/Shanghai",
        sessions: [{ start: "09:30", end: "11:30" }, { start: "13:00", end: "15:00" }],
        holidays: [],
        early_closes: [],
      },
      hk: {
        timezone: "Asia/Hong_Kong",
        sessions: [{ start: "09:30", end: "12:00" }, { start: "13:00", end: "16:00" }],
        holidays: [],
        early_closes: [],
      },
    },
    sources: {
      quotes: {
        hk_primary: "futu_opend",
        cn_a_primary: "eastmoney_public_fallback",
        fallback: ["yahoo_chart_unofficial"],
        optional_paid: [],
      },
      macro: {
        pboc: "official_html",
        nbs: "official_html",
      },
      news: { provider: "official_first_web_fallback", max_items: 40 },
      earnings: { provider: "exchange_announcements", max_items: 40 },
      sectors: { provider: "exchange_or_public_fallback" },
    },
    watchlists: {
      indices: ["000001.SS"],
      sectors: ["semiconductor"],
      macro: ["CNH"],
      cross_market: ["A50"],
      symbols: [],
    },
  };
}

function runArgs() {
  return {
    configName: "us-pre-market",
    jobName: "us-stock-pre-market",
    channelId: "1000000000000000000",
    runAt: new Date("2026-05-08T12:45:00.000Z"),
  };
}

describe("collectMarketIntelOfficialEvidence", () => {
  it("collects US Treasury, BLS, Fed RSS, and SEC filing evidence", async () => {
    const http: MarketIntelOfficialHttpClient = {
      async getText(url) {
        if (url.includes("home.treasury.gov")) {
          return `<?xml version="1.0"?><feed>
            <entry><content><m:properties>
              <d:NEW_DATE>2026-05-07T00:00:00</d:NEW_DATE>
              <d:BC_2YEAR>3.87</d:BC_2YEAR>
              <d:BC_10YEAR>4.28</d:BC_10YEAR>
              <d:BC_30YEAR>4.92</d:BC_30YEAR>
            </m:properties></content></entry>
          </feed>`;
        }
        if (url.includes("federalreserve.gov")) {
          return `<?xml version="1.0"?><rss><channel>
            <item>
              <title><![CDATA[Federal Reserve issues FOMC statement]]></title>
              <link><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/monetary20260429a.htm]]></link>
              <pubDate><![CDATA[Wed, 29 Apr 2026 18:00:00 GMT]]></pubDate>
            </item>
          </channel></rss>`;
        }
        throw new Error(`unexpected getText ${url}`);
      },
      async getJson(url) {
        if (url.includes("company_tickers_exchange")) {
          return { fields: ["cik", "name", "ticker", "exchange"], data: [[320193, "Apple Inc.", "AAPL", "Nasdaq"]] };
        }
        if (url.includes("CIK0000320193")) {
          return {
            filings: {
              recent: {
                form: ["8-K", "10-Q", "4"],
                filingDate: ["2026-05-07", "2026-05-01", "2026-04-30"],
                accessionNumber: ["0000320193-26-000013", "0000320193-26-000011", "0000000000-00-000000"],
                primaryDocument: ["aapl-20260507.htm", "aapl-20260501.htm", "x.htm"],
              },
            },
          };
        }
        throw new Error(`unexpected getJson ${url}`);
      },
      async postJson() {
        return {
          status: "REQUEST_SUCCEEDED",
          Results: {
            series: [
              { seriesID: "CUUR0000SA0", data: [{ year: "2026", periodName: "March", value: "330.213" }] },
              { seriesID: "LNS14000000", data: [{ year: "2026", periodName: "April", value: "4.3" }] },
              { seriesID: "CES0000000001", data: [{ year: "2026", periodName: "April", value: "160560" }] },
            ],
          },
        };
      },
    };

    const result = await collectMarketIntelOfficialEvidence({
      args: runArgs(),
      config: usConfig(),
    }, { http });

    expect(result.macro_policy.status).toBe("ok");
    expect(result.macro_policy.items.map((item) => item.id)).toEqual(expect.arrayContaining([
      "macro.treasury.yield_curve.1",
      "macro.bls.1",
      "macro.bls.2",
      "macro.bls.3",
    ]));
    expect(result.news.items[0]?.title).toContain("FOMC");
    expect(result.filings.items).toHaveLength(2);
    expect(result.earnings.items).toHaveLength(2);
    expect(result.evidence.map((item) => item.id)).toContain("filing.sec.aapl.1");
    expect(result.data_quality_sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "macro.treasury", status: "ok" }),
      expect.objectContaining({ id: "news.federal_reserve", status: "ok" }),
      expect.objectContaining({ id: "filing.sec", status: "ok" }),
    ]));
  });

  it("collects CN official macro pages and SSE announcements", async () => {
    const http: MarketIntelOfficialHttpClient = {
      async getText(url) {
        if (url.includes("pbc.gov.cn")) {
          return `<a href="/zhengcehuobisi/125207/125213/125431/125475/2026050808543589264/index.html" title="Open Market Operations Trading Notice [2026] No.85">Open Market Operations Trading Notice [2026] No.85</a><span class="hui12">2026-05-08</span>`;
        }
        if (url.includes("stats.gov.cn")) {
          return `<a target="_blank" title="Purchasing Managers Index for April 2026" href="./202605/t20260506_1963595.html">Purchasing Managers Index for April 2026</a>`;
        }
        if (url.includes("query.sse.com.cn")) {
          return `jsonpCallback({"pageHelp":{"data":[{"SECURITY_CODE":"600000","SECURITY_NAME":"浦发银行","TITLE":"浦发银行2025年年度报告","SSEDATE":"2026-05-08","URL":"/disclosure/listedinfo/announcement/c/new/2026-05-08/600000.pdf"}]}})`;
        }
        if (url.includes("hkexnews.hk")) {
          return `<table><tbody><tr>
            <td class="text-right text-end release-time"><span>Release Time: </span>08/05/2026 09:05</td>
            <td class="text-right text-end stock-short-code"><span>Stock Code: </span>0700</td>
            <td class="stock-short-name"><span>Stock Short Name: </span>TENCENT</td>
            <td><div class="doc-link"><a href="/listedco/listconews/sehk/2026/0508/2026050800001.pdf">Inside Information - Trading Update</a></div></td>
          </tr></tbody></table>`;
        }
        throw new Error(`unexpected getText ${url}`);
      },
      async getJson() {
        throw new Error("not used");
      },
      async postJson(url) {
        if (url.includes("szse.cn")) {
          return {
            data: [{
              title: "比亚迪：2026年第一季度报告",
              publishTime: "2026-05-08 00:00:00",
              attachPath: "/disc/disk03/finalpage/2026-05-08/byd.pdf",
              secCode: ["002594"],
              secName: ["比亚迪"],
            }],
          };
        }
        throw new Error(`unexpected postJson ${url}`);
      },
    };

    const result = await collectMarketIntelOfficialEvidence({
      args: { ...runArgs(), configName: "cn-pre-market", jobName: "cn-stock-pre-market" },
      config: cnConfig(),
    }, { http });

    expect(result.macro_policy.items.map((item) => item.source)).toEqual(expect.arrayContaining([
      "PBOC open market operations page",
      "NBS latest releases page",
    ]));
    expect(result.filings.items[0]?.source).toBe("SSE listed company announcements");
    expect(result.filings.items.map((item) => item.source)).toEqual(expect.arrayContaining([
      "SZSE listed company announcements",
      "HKEXnews listed company announcements",
    ]));
    expect(result.risks.status).toBe("ok");
    expect(result.data_quality_sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "filing.hkex", status: "ok" }),
      expect.objectContaining({ id: "filing.szse", status: "ok" }),
      expect.objectContaining({ id: "risk.derived", status: "ok" }),
    ]));
  });

  it("keeps source failures redacted and partial", async () => {
    const http: MarketIntelOfficialHttpClient = {
      async getText(url) {
        if (url.includes("home.treasury.gov")) {
          throw new Error("upstream token=abcdefghijklmnopqrstuvwxyz123456 unavailable");
        }
        return `<?xml version="1.0"?><rss><channel></channel></rss>`;
      },
      async getJson() {
        return { fields: ["cik", "name", "ticker", "exchange"], data: [] };
      },
      async postJson() {
        return { Results: { series: [] } };
      },
    };

    const result = await collectMarketIntelOfficialEvidence({
      args: runArgs(),
      config: usConfig({ watchlists: { ...usConfig().watchlists, symbols: [] } }),
    }, { http });

    expect(result.macro_policy.status).toBe("partial");
    expect(result.warnings.join("\n")).toContain("token=[redacted]");
    expect(result.warnings.join("\n")).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(result.data_quality_sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "macro.treasury", status: "failed" }),
    ]));
  });
});
