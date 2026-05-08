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
sources:
  - provider: futu-stock
    config: daily-stock-market
    label: Futu
  - provider: eastmoney-jywg-readonly
    config: daily-stock-market
    label: Eastmoney
    required: false
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
    expect(config.sources).toEqual([
      { provider: "futu-stock", config: "daily-stock-market", label: "Futu", enabled: true, required: false },
      { provider: "eastmoney-jywg-readonly", config: "daily-stock-market", label: "Eastmoney", enabled: true, required: false },
    ]);
  });

  it("rejects unsafe config names and unknown source providers", () => {
    expect(() => getStockPortfolioProviderConfigPath("../secret")).toThrow(/path separators/);
    expect(() => getStockPortfolioProviderConfigPath("config")).toThrow(/reserved/);
    writeConfig("bad", "sources:\n  - provider: unknown\n");
    expect(() => loadStockPortfolioProviderConfig("bad")).toThrow(/must be one of/);
  });
});
