import { describe, expect, it } from "vitest";
import { extractDatedHtmlLinks } from "../collectors/parsers/shared.js";
import {
  parseBlsEvidence,
  parseFederalReserveRssEvidence,
  parseTreasuryYieldCurveEvidence,
} from "../collectors/parsers/macro.js";
import {
  parseHkexAnnouncements,
  parseJsonp,
  parseSecSubmissionsEvidence,
  parseSecTickerCikMap,
  parseSseAnnouncements,
  parseSzseAnnouncements,
  secTickerCandidates,
} from "../collectors/parsers/filings.js";
import { riskKeyword } from "../collectors/parsers/risk.js";

const runAt = new Date("2026-05-08T12:45:00.000Z");

describe("official market-intel source parsers", () => {
  it("parses macro source fixtures without collector HTTP dependencies", () => {
    const treasuryItems = parseTreasuryYieldCurveEvidence({
      xmlText: `<?xml version="1.0"?><feed>
        <entry><content><m:properties>
          <d:NEW_DATE>2026-05-09T00:00:00</d:NEW_DATE>
          <d:BC_2YEAR>3.90</d:BC_2YEAR>
          <d:BC_10YEAR>4.30</d:BC_10YEAR>
          <d:BC_30YEAR>4.95</d:BC_30YEAR>
        </m:properties></content></entry>
        <entry><content><m:properties>
          <d:NEW_DATE>2026-05-07T00:00:00</d:NEW_DATE>
          <d:BC_2YEAR>3.87</d:BC_2YEAR>
          <d:BC_10YEAR>4.28</d:BC_10YEAR>
          <d:BC_30YEAR>4.92</d:BC_30YEAR>
        </m:properties></content></entry>
      </feed>`,
      runAt,
      maxStaleMinutes: 3000,
      url: "https://treasury.example/yield.xml",
    });
    expect(treasuryItems[0]).toMatchObject({
      id: "macro.treasury.yield_curve.1",
      published_at: "2026-05-07",
      freshness: "fresh",
    });
    expect(treasuryItems[0]?.summary).toContain("10Y=4.28%");

    const blsItems = parseBlsEvidence({
      json: {
        Results: {
          series: [
            { seriesID: "CUUR0000SA0", data: [{ year: "2026", periodName: "March", value: "330.213" }] },
            { seriesID: "LNS14000000", data: [{ year: "2026", periodName: "April", value: "-" }] },
          ],
        },
      },
      runAt,
      url: "https://api.bls.gov/publicAPI/v2/timeseries/data/",
    });
    expect(blsItems.map((item) => item.id)).toEqual(["macro.bls.1"]);
    expect(blsItems[0]?.summary).toBe("CPI-U all items: 330.213 for March 2026.");

    const fedItems = parseFederalReserveRssEvidence({
      xmlText: `<?xml version="1.0"?><rss><channel><item>
        <title><![CDATA[Federal Reserve issues FOMC statement]]></title>
        <link><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/monetary20260429a.htm]]></link>
        <pubDate><![CDATA[Wed, 29 Apr 2026 18:00:00 GMT]]></pubDate>
      </item></channel></rss>`,
      runAt,
      maxStaleMinutes: 20_000,
    });
    expect(fedItems[0]).toMatchObject({
      id: "news.federal_reserve.1",
      title: "Federal Reserve issues FOMC statement",
      importance: "high",
    });
  });

  it("parses SEC ticker mapping and recent filing fixtures", () => {
    expect(secTickerCandidates([" aapl ", "AAPL", "bad symbol", "BRK.B"], 10)).toEqual(["AAPL", "BRK.B"]);

    const mapping = parseSecTickerCikMap({
      fields: ["cik", "name", "ticker", "exchange"],
      data: [[320193, "Apple Inc.", "aapl", "Nasdaq"]],
    });
    expect(mapping.get("AAPL")).toBe(320193);

    const items = parseSecSubmissionsEvidence({
      submissions: {
        filings: {
          recent: {
            form: ["4", "8-K", "10-Q", "S-8"],
            filingDate: ["2026-05-04", "2026-05-07", "2026-05-01", "2026-04-30"],
            accessionNumber: ["x", "0000320193-26-000013", "0000320193-26-000011", "z"],
            primaryDocument: ["x.htm", "aapl-20260507.htm", "aapl-20260501.htm", "z.htm"],
          },
        },
      },
      ticker: "AAPL",
      cik: 320193,
      cikPadded: "0000320193",
      runAt,
      itemOffset: 2,
      maxItems: 2,
      maxStaleMinutes: 20_000,
    });

    expect(items.map((item) => item.id)).toEqual(["filing.sec.aapl.3", "filing.sec.aapl.4"]);
    expect(items[0]).toMatchObject({
      title: "AAPL 8-K filing",
      importance: "high",
      symbols: ["AAPL"],
    });
    expect(items[0]?.url).toContain("/Archives/edgar/data/320193/000032019326000013/aapl-20260507.htm");
  });

  it("parses exchange announcement fixtures and keeps row-index-compatible ids", () => {
    const sseJson = parseJsonp(`jsonpCallback({"pageHelp":{"data":[{
      "SECURITY_CODE":"600000",
      "SECURITY_NAME":"浦发银行",
      "TITLE":"浦发银行2025年年度报告",
      "SSEDATE":"2026-05-08",
      "URL":"/disclosure/listedinfo/announcement/c/new/2026-05-08/600000.pdf"
    }]}})`);
    const sseItems = parseSseAnnouncements({ json: sseJson, runAt, maxItems: 10, maxStaleMinutes: 20_000 });
    expect(sseItems[0]).toMatchObject({
      id: "filing.sse.1",
      source: "SSE listed company announcements",
      symbols: ["600000"],
    });

    const szseItems = parseSzseAnnouncements({
      json: {
        data: [
          { title: "Monthly Return", publishTime: "2026-05-08 00:00:00" },
          {
            title: "比亚迪：2026年第一季度报告",
            publishTime: "2026-05-08 00:00:00",
            attachPath: "/disc/disk03/finalpage/2026-05-08/byd.pdf",
            secCode: ["002594"],
            secName: ["比亚迪"],
          },
        ],
      },
      runAt,
      maxItems: 10,
      maxStaleMinutes: 20_000,
    });
    expect(szseItems[0]).toMatchObject({
      id: "filing.szse.2",
      importance: "high",
      symbols: ["002594"],
    });

    const hkexItems = parseHkexAnnouncements({
      html: `<table><tbody>
        <tr><td><div class="doc-link"><a href="/listedco/listconews/sehk/2026/0508/low.pdf">Monthly Return</a></div></td></tr>
        <tr>
          <td class="text-right text-end release-time"><span>Release Time: </span>08/05/2026 09:05</td>
          <td class="text-right text-end stock-short-code"><span>Stock Code: </span>0700</td>
          <td class="stock-short-name"><span>Stock Short Name: </span>TENCENT</td>
          <td><div class="doc-link"><a href="/listedco/listconews/sehk/2026/0508/2026050800001.pdf">Inside Information - Trading Update</a></div></td>
        </tr>
      </tbody></table>`,
      runAt,
      maxItems: 10,
      maxStaleMinutes: 20_000,
    });
    expect(hkexItems[0]).toMatchObject({
      id: "filing.hkex.2",
      published_at: "2026-05-08T09:05:00+08:00",
      symbols: ["0700"],
    });
  });

  it("parses dated official HTML links and derived risk keywords", () => {
    const items = extractDatedHtmlLinks({
      html: `<a href="/zhengce/202605080001/index.html" title="Open Market Operations Trading Notice [2026] No.85">ignored text</a><span>2026-05-08</span>`,
      baseUrl: "http://www.pbc.gov.cn/zhengce/index.html",
      idPrefix: "macro.pboc.omo",
      source: "PBOC open market operations page",
      category: "macro",
      runAt,
      maxItems: 5,
      maxStaleMinutes: 20_000,
      importance: "high",
    });

    expect(items[0]).toMatchObject({
      id: "macro.pboc.omo.1",
      title: "Open Market Operations Trading Notice [2026] No.85",
      importance: "high",
    });
    expect(items[0]?.url).toBe("http://www.pbc.gov.cn/zhengce/202605080001/index.html");
    expect(riskKeyword("Federal Reserve issues FOMC statement")).toBe("macro_policy_event");
    expect(riskKeyword("公司收到监管问询函")).toBe("company_event_risk");
  });
});
