import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getStockPortfolioProviderConfigPath, loadStockPortfolioProviderConfig } from "../config.js";

let tmp: string;
let previousConfigDir: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-stock-portfolio-config-"));
  previousConfigDir = process.env.MINICLAW_STOCK_PORTFOLIO_PROVIDER_CONFIG_DIR;
  process.env.MINICLAW_STOCK_PORTFOLIO_PROVIDER_CONFIG_DIR = tmp;
});

afterEach(() => {
  if (previousConfigDir === undefined) {
    delete process.env.MINICLAW_STOCK_PORTFOLIO_PROVIDER_CONFIG_DIR;
  } else {
    process.env.MINICLAW_STOCK_PORTFOLIO_PROVIDER_CONFIG_DIR = previousConfigDir;
  }
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(name: string, yaml: string): void {
  writeFileSync(join(tmp, `${name}.yaml`), yaml);
}

describe("loadStockPortfolioProviderConfig", () => {
  it("parses enabled read-only broker sources", () => {
    writeConfig("daily-stock-market", `
continue_on_error: true
market_scope: cn
base_currency: CNY
fx_rates:
  CNY: 1
  HKD: 0.92
  USD: 7.2
fx_rates_as_of: "2026-05-08"
fx_rates_source: manual-test
top_movers_limit: 5
include_asset_pie_chart: true
include_equity_lookthrough_summary: true
include_equity_lookthrough_chart: true
equity_lookthrough_top_limit: 30
equity_lookthrough_sources:
  - label: S&P 500
    match_codes: [US.SPY, US.VOO]
    match_names: ["标普500", "S&P 500"]
    constituents:
      - company_key: AAPL
        company: Apple
        code: AAPL
        aliases: [US.AAPL]
        weight_pct: 6.1
      - company_key: GOOGL
        company: Alphabet
        code: GOOGL/GOOG
        aliases: [US.GOOGL, US.GOOG]
        weight_pct: 3.7
sources:
  - provider: futu-stock
    config: daily-stock-market
    label: Futu
    asset_account_label: Futu Combined
    include_asset_totals: false
  - provider: eastmoney-jywg-readonly
    config: daily-stock-market
    label: Eastmoney
    required: false
  - provider: eastmoney-etf-premium
    config: cn-stock
    label: Eastmoney ETF premium
    include_asset_totals: false
`);

    const config = loadStockPortfolioProviderConfig("daily-stock-market");

    expect(config.continue_on_error).toBe(true);
    expect(config.fail_if_all_sources_fail).toBe(true);
    expect(config.market_scope).toBe("cn");
    expect(config.base_currency).toBe("CNY");
    expect(config.fx_rates).toEqual({ CNY: 1, HKD: 0.92, USD: 7.2 });
    expect(config.fx_rates_as_of).toBe("2026-05-08");
    expect(config.fx_rates_source).toBe("manual-test");
    expect(config.top_movers_limit).toBe(5);
    expect(config.include_cny_summary).toBe(true);
    expect(config.include_asset_summary).toBe(false);
    expect(config.include_asset_pie_chart).toBe(true);
    expect(config.include_equity_lookthrough_summary).toBe(true);
    expect(config.include_equity_lookthrough_chart).toBe(true);
    expect(config.equity_lookthrough_top_limit).toBe(30);
    expect(config.equity_lookthrough_sources).toEqual([
      {
        label: "S&P 500",
        match_codes: ["US.SPY", "US.VOO"],
        match_names: ["标普500", "S&P 500"],
        data_source: undefined,
        company_aliases: [],
        constituents: [
          { company_key: "AAPL", company: "Apple", code: "AAPL", aliases: ["US.AAPL"], weight_pct: 6.1 },
          { company_key: "GOOGL", company: "Alphabet", code: "GOOGL/GOOG", aliases: ["US.GOOGL", "US.GOOG"], weight_pct: 3.7 },
        ],
      },
    ]);
    expect(config.sources).toEqual([
      {
        provider: "futu-stock",
        config: "daily-stock-market",
        label: "Futu",
        asset_account_label: "Futu Combined",
        enabled: true,
        required: false,
        include_asset_totals: false,
      },
      {
        provider: "eastmoney-jywg-readonly",
        config: "daily-stock-market",
        label: "Eastmoney",
        asset_account_label: undefined,
        enabled: true,
        required: false,
        include_asset_totals: true,
      },
      {
        provider: "eastmoney-etf-premium",
        config: "cn-stock",
        label: "Eastmoney ETF premium",
        asset_account_label: undefined,
        enabled: true,
        required: false,
        include_asset_totals: false,
      },
    ]);
  });

  it("rejects unsafe config names and unknown source providers", () => {
    expect(() => getStockPortfolioProviderConfigPath("../secret")).toThrow(/path separators/);
    expect(() => getStockPortfolioProviderConfigPath("config")).toThrow(/reserved/);
    writeConfig("bad", "sources:\n  - provider: unknown\n");
    expect(() => loadStockPortfolioProviderConfig("bad")).toThrow(/must be one of/);
  });
});
