import { describe, expect, it } from "vitest";
import { analyzeStockPulseSeries } from "../analyzer.js";
import type { StockPulseQuoteBar, StockPulseThresholdConfig } from "../types.js";

const thresholds: StockPulseThresholdConfig = {
  stock: {
    hour_abs_pct: 2,
    day_abs_pct: 4,
    bar_abs_pct: 0.6,
    bar_sigma_multiplier: 2,
    abnormal_bar_count: 3,
    same_direction_bars: 10,
    z_score: 2,
    urgent_z_score: 3,
  },
  etf: {
    hour_abs_pct: 1,
    day_abs_pct: 2,
    bar_abs_pct: 0.35,
    bar_sigma_multiplier: 2,
    abnormal_bar_count: 3,
    same_direction_bars: 10,
    z_score: 2,
    urgent_z_score: 3,
  },
  leveraged_etf: {
    hour_abs_pct: 2,
    day_abs_pct: 4,
    bar_abs_pct: 0.8,
    bar_sigma_multiplier: 2,
    abnormal_bar_count: 3,
    same_direction_bars: 10,
    z_score: 2.5,
    urgent_z_score: 3.5,
  },
};

function barsWithLateSpike(): StockPulseQuoteBar[] {
  const start = Date.parse("2026-05-08T13:30:00.000Z");
  const bars: StockPulseQuoteBar[] = [];
  let price = 100;
  for (let i = 0; i < 90; i++) {
    if (i >= 78) price *= 1.007;
    else price *= i % 2 === 0 ? 1.0002 : 0.9998;
    bars.push({
      timestamp: new Date(start + i * 5 * 60 * 1000).toISOString(),
      close: Math.round(price * 100) / 100,
    });
  }
  return bars;
}

describe("analyzeStockPulseSeries", () => {
  it("flags abnormal hourly move frequency against historical baseline", () => {
    const alert = analyzeStockPulseSeries({
      symbol: {
        symbol: "AAPL",
        yahoo_symbol: "AAPL",
        market: "us",
        instrument_type: "stock",
        sources: ["watchlist"],
      },
      series: {
        symbol: "AAPL",
        provider_symbol: "AAPL",
        market: "us",
        previous_close: 100,
        bars: barsWithLateSpike(),
      },
      thresholds,
      marketTimezone: "America/New_York",
    });

    expect(alert).toBeDefined();
    expect(alert?.triggers).toContain("abnormal_frequency");
    expect(alert?.triggers).toContain("z_score");
    expect(alert?.severity).toBe("urgent");
  });
});
