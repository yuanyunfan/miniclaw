import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMarketForecastEvaluationProviderConfig } from "../config.js";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  delete process.env.MINICLAW_MARKET_FORECAST_EVALUATION_CONFIG_DIR;
});

function writeConfig(name: string, body: string): void {
  tempDir = join(tmpdir(), `miniclaw-market-forecast-eval-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
  process.env.MINICLAW_MARKET_FORECAST_EVALUATION_CONFIG_DIR = tempDir;
  writeFileSync(join(tempDir, `${name}.yaml`), body);
}

describe("market-forecast-evaluation config", () => {
  it("loads benchmark and portfolio config", () => {
    writeConfig("us-post-market", `
market_scope: us
timezone: America/New_York
portfolio_provider_config: us-stock
direction_threshold_pct: 0.25
benchmark_symbols:
  - symbol: SPY
    provider_symbol: SPY
    label: S&P 500 ETF
`);

    const config = loadMarketForecastEvaluationProviderConfig("us-post-market");

    expect(config.market_scope).toBe("us");
    expect(config.timezone).toBe("America/New_York");
    expect(config.portfolio_provider_config).toBe("us-stock");
    expect(config.direction_threshold_pct).toBe(0.25);
    expect(config.benchmark_symbols[0]).toEqual({
      symbol: "SPY",
      provider_symbol: "SPY",
      label: "S&P 500 ETF",
    });
  });

  it("rejects missing benchmarks", () => {
    writeConfig("bad", `
market_scope: us
benchmark_symbols: []
`);

    expect(() => loadMarketForecastEvaluationProviderConfig("bad")).toThrow(/benchmark_symbols/);
  });
});
