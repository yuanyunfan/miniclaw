import { describe, expect, it } from "vitest";
import {
  buildAssetPieChartModel,
  classifyPieHolding,
  renderAssetPieChartSvg,
} from "../../../stock/reports/portfolio-pie-chart.js";
import type { StockPortfolioAssetSummary, StockPortfolioClassifiableHolding } from "../../../stock/data/portfolio-types.js";

function holding(overrides: Partial<StockPortfolioClassifiableHolding>): StockPortfolioClassifiableHolding {
  return {
    provider: "futu-stock",
    config: "daily-stock-summary",
    source_label: "Futu",
    code: "UNKNOWN",
    name: "UNKNOWN",
    source_currency: "CNY",
    market_value_cny: 1,
    fx_rate_to_cny: 1,
    ...overrides,
  };
}

describe("stock portfolio pie chart", () => {
  it("classifies common daily summary holdings into chart labels", () => {
    expect(classifyPieHolding(holding({ code: "511090", name: "30年国债ETF" }))).toBe("长债");
    expect(classifyPieHolding(holding({ code: "511520", name: "政金债券ETF" }))).toBe("政金债");
    expect(classifyPieHolding(holding({ code: "511030", name: "公司信用债ETF" }))).toBe("信用债");
    expect(classifyPieHolding(holding({ code: "510300", name: "沪深300ETF" }))).toBe("国内股票");
    expect(classifyPieHolding(holding({ code: "US.QQQ", name: "NASDAQ 100 ETF" }))).toBe("海外股票");
    expect(classifyPieHolding(holding({ code: "512800", name: "银行ETF", instrument_type: "etf" }))).toBe("国内股票");
    expect(classifyPieHolding(holding({ code: "510310", name: "HS300ETF", instrument_type: "etf" }))).toBe("国内股票");
    expect(classifyPieHolding(holding({ code: "518880", name: "黄金ETF" }))).toBe("黄金");
  });

  it("builds a stable first-level pie chart model with cash included", () => {
    const summary: StockPortfolioAssetSummary = {
      base_currency: "CNY",
      fx_rates: { CNY: 1 },
      total_assets_cny: 1000,
      market_value_cny: 910,
      cash_cny: 90,
      by_account: [],
      by_category: [],
      holdings_for_classification: [
        holding({ code: "511090", name: "30年国债ETF", market_value_cny: 210 }),
        holding({ code: "511520", name: "政金债券ETF", market_value_cny: 90 }),
        holding({ code: "511030", name: "公司信用债ETF", market_value_cny: 50 }),
        holding({ code: "510300", name: "沪深300ETF", market_value_cny: 150 }),
        holding({ code: "US.QQQ", name: "NASDAQ 100 ETF", market_value_cny: 350 }),
        holding({ code: "518880", name: "黄金ETF", market_value_cny: 60 }),
      ],
      classification_guidance: { mode: "llm", categories: [], cash_handling: "", instructions: [] },
      warnings: [],
    };

    const model = buildAssetPieChartModel(summary);

    expect(model?.slices.map((slice) => [slice.label, slice.percentage])).toEqual([
      ["长债", 21],
      ["政金债", 9],
      ["信用债", 5],
      ["国内股票", 15],
      ["海外股票", 35],
      ["黄金", 6],
      ["现金", 9],
    ]);
    const svg = renderAssetPieChartSvg(model!);
    expect(svg).toContain("海外股票");
    expect(svg).toContain("35%");
  });
});
