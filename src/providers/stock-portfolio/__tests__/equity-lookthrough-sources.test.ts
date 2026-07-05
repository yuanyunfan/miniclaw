import { afterEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { resolveEquityLookthroughSources, __testables } from "../../../stock/data/equity-lookthrough-sources.js";
import type { StockPortfolioProviderConfig } from "../../../stock/data/portfolio-types.js";

const baseConfig: StockPortfolioProviderConfig = {
  continue_on_error: true,
  fail_if_all_sources_fail: true,
  market_scope: "all",
  base_currency: "CNY",
  fx_rates: { CNY: 1 },
  top_movers_limit: 5,
  include_cny_summary: true,
  include_asset_summary: true,
  include_asset_pie_chart: false,
  include_equity_lookthrough_summary: true,
  include_equity_lookthrough_chart: false,
  equity_lookthrough_top_limit: 30,
  equity_lookthrough_sources: [],
  sources: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("equity look-through dynamic sources", () => {
  it("limits dynamic source concurrency while preserving result order", async () => {
    let active = 0;
    let maxActive = 0;
    const results = await __testables.mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return item * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("resolves JSON holdings and applies security aliases without static weights", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => Buffer.from(JSON.stringify({
        holdings: [
          { ticker: "GOOG", issuerName: "Alphabet Inc Class C", percentageOfTotalNetAssets: 2.5 },
          { ticker: "NVDA", issuerName: "NVIDIA Corp", percentageOfTotalNetAssets: 7.6 },
        ],
      })),
    })));

    const resolved = await resolveEquityLookthroughSources({
      ...baseConfig,
      equity_lookthrough_sources: [
        {
          label: "Nasdaq 100",
          match_codes: ["US.QQQ"],
          match_names: [],
          company_aliases: [
            { company_key: "GOOGL", company: "Alphabet", code: "GOOGL/GOOG", aliases: ["GOOGL", "GOOG"] },
          ],
          constituents: [],
          data_source: {
            type: "http_json",
            url: "https://example.test/qqq.json",
            items_path: "holdings",
            timeout_ms: 1000,
            columns: {
              company: ["issuerName"],
              code: ["ticker"],
              weight_pct: ["percentageOfTotalNetAssets"],
            },
          },
        },
      ],
    });

    expect(resolved.warnings).toEqual([]);
    expect(resolved.config.equity_lookthrough_sources[0].constituents).toEqual([
      { company_key: "GOOGL", company: "Alphabet", code: "GOOGL/GOOG", aliases: ["GOOGL", "GOOG"], weight_pct: 2.5 },
      { company_key: undefined, company: "NVIDIA Corp", code: "NVDA", aliases: [], weight_pct: 7.6 },
    ]);
  });

  it("retries transient dynamic source fetch failures before downgrading the source", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("socket reset"))
      .mockRejectedValueOnce(new Error("temporary fetch failed"))
      .mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Buffer.from(JSON.stringify({
          holdings: [
            { ticker: "AAPL", issuerName: "Apple Inc", percentageOfTotalNetAssets: 8.1 },
          ],
        })),
      });
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveEquityLookthroughSources({
      ...baseConfig,
      equity_lookthrough_sources: [
        {
          label: "Nasdaq 100",
          match_codes: ["US.QQQ"],
          match_names: [],
          company_aliases: [],
          constituents: [],
          data_source: {
            type: "http_json",
            url: "https://example.test/qqq.json",
            items_path: "holdings",
            timeout_ms: 1000,
            columns: {
              company: ["issuerName"],
              code: ["ticker"],
              weight_pct: ["percentageOfTotalNetAssets"],
            },
          },
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(resolved.warnings).toEqual([]);
    expect(resolved.config.equity_lookthrough_sources[0].constituents).toEqual([
      { company_key: undefined, company: "Apple Inc", code: "AAPL", aliases: [], weight_pct: 8.1 },
    ]);
  });

  it("parses xlsx holdings tables by header names", () => {
    const xlsx = zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "xl/sharedStrings.xml": strToU8([
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        "<si><t>Name</t></si><si><t>Ticker</t></si><si><t>Weight</t></si>",
        "<si><t>NVIDIA CORP</t></si><si><t>NVDA</t></si>",
        "</sst>",
      ].join("")),
      "xl/worksheets/sheet1.xml": strToU8([
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
        '<row><c t="s"><v>0</v></c><c t="s"><v>1</v></c><c t="s"><v>2</v></c></row>',
        '<row><c t="s"><v>3</v></c><c t="s"><v>4</v></c><c><v>7.438537</v></c></row>',
        "</sheetData></worksheet>",
      ].join("")),
    });

    const rows = __testables.parseXlsx(xlsx, {
      company: ["Name"],
      code: ["Ticker"],
      weight_pct: ["Weight"],
    });

    expect(rows).toEqual([
      { Name: "NVIDIA CORP", Ticker: "NVDA", Weight: "7.438537" },
    ]);
  });

  it("parses Eastmoney fund stock holdings from apidata HTML", async () => {
    const eastmoneyPayload = [
      'var apidata={ content:"<table><thead><tr>',
      "<th>序号</th><th>股票代码</th><th>股票名称</th><th>最新价</th><th>涨跌幅</th><th>相关资讯</th><th>占净值<br />比例</th>",
      "</tr></thead><tbody>",
      "<tr><td>1</td><td><a>300750</a></td><td class='tol'><a>宁德时代</a></td><td></td><td></td><td></td><td>3.80%</td></tr>",
      "<tr><td>2</td><td><a>600519</a></td><td class='tol'><a>贵州茅台</a></td><td></td><td></td><td></td><td>3.21%</td></tr>",
      '</tbody></table>",arryear:[2026],curyear:2026};',
    ].join("");

    expect(__testables.parseEastmoneyFundHoldings(eastmoneyPayload)).toEqual([
      { "股票代码": "300750", "股票名称": "宁德时代", "占净值比例": "3.80%" },
      { "股票代码": "600519", "股票名称": "贵州茅台", "占净值比例": "3.21%" },
    ]);

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => Buffer.from(eastmoneyPayload),
    })));

    const resolved = await resolveEquityLookthroughSources({
      ...baseConfig,
      equity_lookthrough_sources: [
        {
          label: "中证A500",
          match_codes: ["159338"],
          match_names: [],
          company_aliases: [],
          constituents: [],
          data_source: {
            type: "eastmoney_fund_holdings",
            url: "https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=159338&topline=200&year=&month=",
            timeout_ms: 1000,
            columns: {
              company: ["股票名称"],
              code: ["股票代码"],
              weight_pct: ["占净值比例"],
            },
          },
        },
      ],
    });

    expect(resolved.warnings).toEqual([]);
    expect(resolved.config.equity_lookthrough_sources[0].constituents).toEqual([
      { company_key: undefined, company: "宁德时代", code: "300750", aliases: [], weight_pct: 3.8 },
      { company_key: undefined, company: "贵州茅台", code: "600519", aliases: [], weight_pct: 3.21 },
    ]);
  });
});
