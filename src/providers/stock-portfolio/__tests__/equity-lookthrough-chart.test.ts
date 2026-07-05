import { describe, expect, it } from "vitest";
import { renderEquityLookthroughChartSvg } from "../../../stock/reports/portfolio-equity-lookthrough-chart.js";
import type { StockPortfolioEquityLookthroughSummary } from "../../../stock/data/portfolio-types.js";

describe("stock portfolio equity look-through chart", () => {
  it("renders a table-style svg with ranked exposure rows", () => {
    const summary: StockPortfolioEquityLookthroughSummary = {
      base_currency: "CNY",
      total_assets_cny: 100000,
      stock_position_cny: 70000,
      expanded_amount_cny: 15700,
      expanded_stock_position_percentage: 22.43,
      top_limit: 30,
      rows: [
        {
          rank: 1,
          company_key: "NVDA",
          company: "NVIDIA",
          code: "NVDA",
          lookthrough_amount_cny: 15700,
          percentage_of_total_assets_cny: 15.7,
          percentage_of_stock_position_cny: 22.43,
          source_labels: ["直接", "S&P 500", "Nasdaq 100"],
          sources: [
            { label: "直接", amount_cny: 12000 },
            { label: "S&P 500", amount_cny: 2100 },
            { label: "Nasdaq 100", amount_cny: 1600 },
          ],
        },
      ],
      warnings: [],
      usage_notes: [],
    };

    const svg = renderEquityLookthroughChartSvg(summary);

    expect(svg).toContain("整体个股穿透持仓 Top 30");
    expect(svg).toContain("NVIDIA");
    expect(svg).toContain("NVDA");
    expect(svg).toContain("S&amp;P 500");
    expect(svg).toContain("15.70%");
  });
});
