import { beforeEach, describe, expect, it, vi } from "vitest";

const futuMocks = vi.hoisted(() => ({
  getFutuWatchlistSecuritiesResult: vi.fn(),
  loadFutuStockConfig: vi.fn(() => ({ profiles: { default: {} } })),
  resolveFutuStockProfile: vi.fn((_config: unknown, name = "default") => ({ profile_name: name })),
}));

vi.mock("../../../mcp/futu-stock/futu-client.js", () => ({
  getFutuWatchlistSecuritiesResult: futuMocks.getFutuWatchlistSecuritiesResult,
}));

vi.mock("../../../mcp/futu-stock/config.js", () => ({
  loadFutuStockConfig: futuMocks.loadFutuStockConfig,
  resolveFutuStockProfile: futuMocks.resolveFutuStockProfile,
}));

import {
  __testables,
  getFutuWatchlistUniverseSymbolsBatch,
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
  beforeEach(() => {
    futuMocks.getFutuWatchlistSecuritiesResult.mockReset();
    futuMocks.loadFutuStockConfig.mockClear();
    futuMocks.resolveFutuStockProfile.mockClear();
  });

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

  it("collects one Futu batch and maps mixed-market rows per source", async () => {
    futuMocks.getFutuWatchlistSecuritiesResult.mockResolvedValueOnce({
      captured_at: "2026-05-18T00:00:00.000Z",
      group_count: 1,
      securities: [
        { group_name: "All", code: "US.AAPL", name: "Apple" },
        { group_name: "All", code: "HK.00700", name: "Tencent" },
        { group_name: "All", code: "FX.EURUSD", name: "EUR/USD" },
      ],
      group_errors: [],
      rate_limited: false,
    });

    const cnSource = source("cn-a");
    const hkSource = source("hk");
    const results = await getFutuWatchlistUniverseSymbolsBatch([cnSource, hkSource]);

    expect(futuMocks.getFutuWatchlistSecuritiesResult).toHaveBeenCalledTimes(1);
    expect(futuMocks.getFutuWatchlistSecuritiesResult.mock.calls[0]?.[1]).toMatchObject({ limit: expect.any(Number) });
    expect(futuMocks.getFutuWatchlistSecuritiesResult.mock.calls[0]?.[1]?.limit).toBeGreaterThan(cnSource.limit + hkSource.limit);
    expect(results.find((item) => item.source === cnSource)?.symbols).toEqual([]);
    expect(results.find((item) => item.source === hkSource)?.symbols).toEqual([
      {
        symbol: "00700",
        name: "Tencent",
        market: "hk",
        source: "universe:hk-watchlist:All",
      },
    ]);
  });

  it("reports all-group Futu rate limits as unavailable instead of empty", async () => {
    futuMocks.getFutuWatchlistSecuritiesResult.mockResolvedValueOnce({
      captured_at: "2026-05-18T00:00:00.000Z",
      group_count: 1,
      securities: [],
      group_errors: [{ group_name: "All", error: "获取自选股分组频率太高，请求失败，每30秒最多10次。", rate_limited: true }],
      rate_limited: true,
    });

    const [result] = await getFutuWatchlistUniverseSymbolsBatch([source("hk")]);

    expect(result?.symbols).toEqual([]);
    expect(result?.unavailable).toBe(true);
    expect(result?.warnings.join("\n")).toContain("rate-limited");
    expect(result?.warnings.join("\n")).toContain("频率太高");
  });
});
