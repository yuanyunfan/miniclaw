import { describe, expect, it } from "vitest";
import { __testables } from "../research-client.js";
import type { StockPulseSymbol } from "../../stock-pulse/types.js";

const symbol: StockPulseSymbol = {
  symbol: "AAPL",
  yahoo_symbol: "AAPL",
  market: "us",
  instrument_type: "stock",
  sources: ["universe:futu-us-watchlist:US"],
};

describe("stock-watchlist-research Yahoo parsers", () => {
  it("parses profile from Yahoo search payload", () => {
    const profile = __testables.parseProfile({
      quotes: [{
        symbol: "AAPL",
        quoteType: "EQUITY",
        exchange: "NMS",
        sector: "Technology",
        industry: "Consumer Electronics",
        longname: "Apple Inc.",
      }],
    }, symbol);

    expect(profile).toMatchObject({
      symbol: "AAPL",
      provider_symbol: "AAPL",
      quote_type: "EQUITY",
      exchange: "NMS",
      sector: "Technology",
      industry: "Consumer Electronics",
      long_name: "Apple Inc.",
      source: "yahoo_finance_search",
    });
  });

  it("parses news and filters malformed rows", () => {
    const news = __testables.parseNews({
      news: [
        {
          title: "Apple reports earnings",
          publisher: "Wire",
          providerPublishTime: 1770000000,
          link: "https://example.com/aapl",
          relatedTickers: ["AAPL", ""],
        },
        { publisher: "No title" },
      ],
    });

    expect(news).toEqual([expect.objectContaining({
      title: "Apple reports earnings",
      publisher: "Wire",
      published_at: "2026-02-02T02:40:00.000Z",
      url: "https://example.com/aapl",
      related_tickers: ["AAPL"],
    })]);
  });

  it("parses latest financial points from fundamentals timeseries", () => {
    const financials = __testables.parseFinancials({
      timeseries: {
        result: [{
          annualTotalRevenue: [
            { asOfDate: "2024-09-30", periodType: "12M", reportedValue: { raw: 100, fmt: "100" } },
            { asOfDate: "2025-09-30", periodType: "12M", reportedValue: { raw: 120, fmt: "120" } },
          ],
          quarterlyNetIncome: [
            { asOfDate: "2026-03-31", periodType: "3M", reportedValue: { raw: 10, fmt: "10" } },
          ],
        }],
      },
    });

    expect(financials).toEqual([
      expect.objectContaining({ type: "annualTotalRevenue", as_of_date: "2025-09-30", raw: 120, fmt: "120" }),
      expect.objectContaining({ type: "quarterlyNetIncome", as_of_date: "2026-03-31", raw: 10, fmt: "10" }),
    ]);
  });
});
