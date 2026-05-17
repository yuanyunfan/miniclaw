import { describe, expect, it } from "vitest";
import {
  __testables,
  mapEastmoneyMyfavorSymbols,
  mapFutuWatchlistSymbols,
} from "../../../stock/sources/watchlists.js";
import type { StockPulseUniverseSourceConfig } from "../../../stock/data/pulse-types.js";

function source(market: StockPulseUniverseSourceConfig["market"]): StockPulseUniverseSourceConfig {
  return {
    type: "futu_watchlist",
    name: `${market}-watchlist`,
    market,
    enabled: true,
    limit: 20,
  };
}

describe("stock-pulse watchlist universe sources", () => {
  it("maps Futu watchlist securities by market prefix", () => {
    const mapped = mapFutuWatchlistSymbols([
      { group_name: "US", code: "US.AAPL", name: "Apple" },
      { group_name: "HK", code: "HK.00700", name: "Tencent" },
      { group_name: "CN", code: "SH.600000", name: "浦发银行" },
      { group_name: "CN", code: "SZ.159513", name: "纳指 ETF" },
    ], source("cn-a"));

    expect(mapped).toEqual([
      {
        symbol: "600000",
        name: "浦发银行",
        market: "cn-a",
        source: "universe:cn-a-watchlist:CN",
      },
      {
        symbol: "159513",
        name: "纳指 ETF",
        market: "cn-a",
        source: "universe:cn-a-watchlist:CN",
      },
    ]);
    expect(__testables.symbolFromFutuCode("HK.00700")).toBe("00700");
    expect(__testables.marketFromFutuCode("US.AAPL")).toBe("us");
    expect(__testables.marketFromFutuCode("HK.00700")).toBe("hk");
  });

  it("maps Eastmoney myfavor securities by market flag", () => {
    const eastmoneySource: StockPulseUniverseSourceConfig = {
      type: "eastmoney_myfavor_watchlist",
      name: "eastmoney-us-watchlist",
      market: "us",
      enabled: true,
      limit: 20,
    };

    const mapped = mapEastmoneyMyfavorSymbols([
      { group_id: "1", group_name: "美股", security: "105$AAPL", code: "AAPL", name: "Apple", market_flag: "105" },
      { group_id: "1", group_name: "美股", security: "106$TSLA", code: "TSLA", name: "Tesla", market_flag: "106" },
      { group_id: "2", group_name: "港股", security: "116$00700", code: "00700", name: "Tencent", market_flag: "116" },
      { group_id: "3", group_name: "A股", security: "1$600000", code: "600000", name: "浦发银行", market_flag: "1" },
      { group_id: "3", group_name: "A股", security: "0$000001", code: "000001", name: "平安银行", market_flag: "0" },
    ], eastmoneySource);

    expect(mapped).toEqual([
      {
        symbol: "AAPL",
        name: "Apple",
        market: "us",
        source: "universe:eastmoney-us-watchlist:美股",
      },
      {
        symbol: "TSLA",
        name: "Tesla",
        market: "us",
        source: "universe:eastmoney-us-watchlist:美股",
      },
    ]);
    expect(__testables.marketFromEastmoneyFlag("116")).toBe("hk");
    expect(__testables.marketFromEastmoneyFlag("1")).toBe("cn-a");
    expect(__testables.marketFromEastmoneyFlag("0")).toBe("cn-a");
  });

  it("applies source limit after market filtering", () => {
    const limited = mapFutuWatchlistSymbols([
      { group_name: "US", code: "US.AAPL" },
      { group_name: "US", code: "US.MSFT" },
    ], { ...source("us"), limit: 1 });

    expect(limited).toHaveLength(1);
    expect(limited[0]?.symbol).toBe("AAPL");
  });
});
