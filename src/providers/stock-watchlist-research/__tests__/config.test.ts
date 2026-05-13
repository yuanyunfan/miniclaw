import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getStockWatchlistResearchConfigPath, loadStockWatchlistResearchConfig } from "../config.js";

let tmp: string;
let previousConfigDir: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-stock-watchlist-research-config-"));
  previousConfigDir = process.env.MINICLAW_STOCK_WATCHLIST_RESEARCH_CONFIG_DIR;
  process.env.MINICLAW_STOCK_WATCHLIST_RESEARCH_CONFIG_DIR = tmp;
});

afterEach(() => {
  if (previousConfigDir === undefined) {
    delete process.env.MINICLAW_STOCK_WATCHLIST_RESEARCH_CONFIG_DIR;
  } else {
    process.env.MINICLAW_STOCK_WATCHLIST_RESEARCH_CONFIG_DIR = previousConfigDir;
  }
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(name: string, yaml: string): void {
  writeFileSync(join(tmp, `${name}.yaml`), yaml);
}

describe("loadStockWatchlistResearchConfig", () => {
  it("parses watchlist research config with defaults", () => {
    writeConfig("us-pre-market", `
market_scope: us
run_type: pre_market
market_intel_config: us-pre-market
max_symbols: 25
quote:
  interval: 15m
  range: 1mo
research:
  news_count_per_symbol: 4
`);

    const config = loadStockWatchlistResearchConfig("us-pre-market");

    expect(config.market_scope).toBe("us");
    expect(config.run_type).toBe("pre_market");
    expect(config.timezone).toBe("America/New_York");
    expect(config.stock_pulse_config).toBe("us-hourly");
    expect(config.market_intel_config).toBe("us-pre-market");
    expect(config.max_symbols).toBe(25);
    expect(config.quote.interval).toBe("15m");
    expect(config.quote.range).toBe("1mo");
    expect(config.quote.concurrency).toBe(4);
    expect(config.research.news_count_per_symbol).toBe(4);
    expect(config.research.enabled).toBe(true);
  });

  it("parses cn daily config and rejects unsafe config names", () => {
    writeConfig("cn-daily", `
market_scope: cn
run_type: daily
research:
  enabled: false
`);

    const config = loadStockWatchlistResearchConfig("cn-daily");

    expect(config.timezone).toBe("Asia/Shanghai");
    expect(config.stock_pulse_config).toBe("cn-hourly");
    expect(config.research.enabled).toBe(false);
    expect(() => getStockWatchlistResearchConfigPath("../secret")).toThrow(/path separators/);
    expect(() => getStockWatchlistResearchConfigPath("config")).toThrow(/reserved/);
  });
});
