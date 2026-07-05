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
});
