import { describe, expect, it } from "vitest";
import { extractPortfolioSymbols, toYahooSymbol } from "../../../stock/data/universe.js";

describe("stock-pulse symbol mapping", () => {
  it("maps US class-share dots to Yahoo hyphen symbols", () => {
    expect(toYahooSymbol("US.BRK.B", "us")).toBe("BRK-B");
    expect(toYahooSymbol("BRK.B", "us")).toBe("BRK-B");
  });

  it("keeps exchange suffixes for CN and HK symbols", () => {
    expect(toYahooSymbol("SH.600000", "cn-a")).toBe("600000.SS");
    expect(toYahooSymbol("HK.700", "hk")).toBe("0700.HK");
  });

  it("normalizes HKEX five-digit codes to Yahoo four-digit tickers", () => {
    expect(toYahooSymbol("HK.01810", "hk")).toBe("1810.HK");
    expect(toYahooSymbol("01810", "hk")).toBe("1810.HK");
    expect(toYahooSymbol("01810.HK", "hk")).toBe("1810.HK");
    expect(toYahooSymbol("HK.00700", "hk")).toBe("0700.HK");
    expect(toYahooSymbol("HK.00005", "hk")).toBe("0005.HK");
  });

  it("extracts Eastmoney position premium rows as held portfolio symbols", () => {
    const symbols = extractPortfolioSymbols({
      sources: [
        {
          provider: "eastmoney-jywg-readonly",
          config: "cn-stock",
          label: "Eastmoney CN",
          status: "ok",
          payload: {
            positions_summary: {
              positions_count: 1,
              top_positions: [],
              top_gainers: [],
              top_losers: [],
              position_premiums: [{ code: "513500", name: "标普500ETF", currency: "CNY" }],
            },
          },
        },
      ],
    }, "cn");

    expect(symbols.map((symbol) => ({
      symbol: symbol.symbol,
      yahoo_symbol: symbol.yahoo_symbol,
      market: symbol.market,
      sources: symbol.sources,
    }))).toEqual([
      {
        symbol: "513500",
        yahoo_symbol: "513500.SS",
        market: "cn-a",
        sources: ["portfolio:Eastmoney CN"],
      },
    ]);
  });
});
