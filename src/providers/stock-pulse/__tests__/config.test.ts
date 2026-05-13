import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getStockPulseProviderConfigPath, loadStockPulseProviderConfig } from "../config.js";

let tmp: string;
let previousConfigDir: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-stock-pulse-config-"));
  previousConfigDir = process.env.MINICLAW_STOCK_PULSE_PROVIDER_CONFIG_DIR;
  process.env.MINICLAW_STOCK_PULSE_PROVIDER_CONFIG_DIR = tmp;
});

afterEach(() => {
  if (previousConfigDir === undefined) {
    delete process.env.MINICLAW_STOCK_PULSE_PROVIDER_CONFIG_DIR;
  } else {
    process.env.MINICLAW_STOCK_PULSE_PROVIDER_CONFIG_DIR = previousConfigDir;
  }
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(name: string, yaml: string): void {
  writeFileSync(join(tmp, `${name}.yaml`), yaml);
}

describe("loadStockPulseProviderConfig", () => {
  it("parses hourly stock pulse config with defaults", () => {
    writeConfig("us-hourly", `
market_scope: us
portfolio_provider_config: us-stock
active_window:
  timezone: Asia/Shanghai
  start: "09:30"
  end: "01:00"
universe:
  max_symbols: 40
  symbols:
    - symbol: AAPL
      name: Apple
      market: us
      instrument_type: stock
  sources:
    - type: yahoo_screener
      name: us-gainers
      market: us
      scr_id: day_gainers
      limit: 20
quote:
  interval: 5m
  range: 60d
thresholds:
  stock:
    hour_abs_pct: 1.8
`);

    const config = loadStockPulseProviderConfig("us-hourly");

    expect(config.market_scope).toBe("us");
    expect(config.portfolio_provider_config).toBe("us-stock");
    expect(config.active_window.end).toBe("01:00");
    expect(config.markets.us?.timezone).toBe("America/New_York");
    expect(config.universe.max_symbols).toBe(40);
    expect(config.universe.include_sources).toBe(false);
    expect(config.universe.symbols[0]?.symbol).toBe("AAPL");
    expect(config.universe.sources[0]?.scr_id).toBe("day_gainers");
    expect(config.quote.concurrency).toBe(4);
    expect(config.thresholds.stock.hour_abs_pct).toBe(1.8);
    expect(config.thresholds.etf.hour_abs_pct).toBe(1);
  });

  it("parses broker watchlist universe sources", () => {
    writeConfig("cn-hourly", `
market_scope: cn
universe:
  include_sources: true
  sources:
    - type: futu_watchlist
      name: futu-cn-watchlist
      market: cn-a
      profile: default
      groups:
        - A股
        - ETF
      limit: 30
    - type: eastmoney_myfavor_watchlist
      name: eastmoney-hk-watchlist
      market: hk
      config: myfavor
      group: 港股
      limit: 20
`);

    const config = loadStockPulseProviderConfig("cn-hourly");

    expect(config.universe.include_sources).toBe(true);
    expect(config.universe.sources).toEqual([
      expect.objectContaining({
        type: "futu_watchlist",
        name: "futu-cn-watchlist",
        market: "cn-a",
        profile: "default",
        groups: ["A股", "ETF"],
        limit: 30,
      }),
      expect.objectContaining({
        type: "eastmoney_myfavor_watchlist",
        name: "eastmoney-hk-watchlist",
        market: "hk",
        config: "myfavor",
        groups: ["港股"],
        limit: 20,
      }),
    ]);
  });

  it("rejects unsafe config names and invalid universe sources", () => {
    expect(() => getStockPulseProviderConfigPath("../secret")).toThrow(/path separators/);
    expect(() => getStockPulseProviderConfigPath("config")).toThrow(/reserved/);
    writeConfig("bad", `
market_scope: cn
universe:
  sources:
    - type: yahoo_screener
      market: us
`);
    expect(() => loadStockPulseProviderConfig("bad")).toThrow(/requires scr_id/);
  });
});
