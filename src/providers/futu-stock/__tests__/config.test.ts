import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFutuStockProviderConfigPath, loadFutuStockProviderConfig, resolveFutuProviderMarketSession } from "../config.js";

let tmp: string;
let previousConfigDir: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-futu-provider-config-"));
  previousConfigDir = process.env.MINICLAW_FUTU_STOCK_PROVIDER_CONFIG_DIR;
  process.env.MINICLAW_FUTU_STOCK_PROVIDER_CONFIG_DIR = tmp;
});

afterEach(() => {
  if (previousConfigDir === undefined) {
    delete process.env.MINICLAW_FUTU_STOCK_PROVIDER_CONFIG_DIR;
  } else {
    process.env.MINICLAW_FUTU_STOCK_PROVIDER_CONFIG_DIR = previousConfigDir;
  }
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(name: string, yaml: string): void {
  writeFileSync(join(tmp, `${name}.yaml`), yaml);
}

describe("loadFutuStockProviderConfig", () => {
  it("parses provider defaults and per-job market sessions", () => {
    writeConfig("daily-stock-market", `
profile: default
account_alias: Futu
redaction: summary
top_positions_limit: 6
market_session_by_job:
  stock-market-premarket: premarket_0915
  a-share-hk-postmarket: a_hk_postmarket_1515
`);

    const config = loadFutuStockProviderConfig("daily-stock-market");

    expect(config).toMatchObject({
      profile: "default",
      account_alias: "Futu",
      redaction: "summary",
      top_positions_limit: 6,
      include_account_snapshot: true,
      include_daily_report: true,
      include_positions_summary: true,
    });
    expect(resolveFutuProviderMarketSession(config, "stock-market-premarket")).toBe("premarket_0915");
    expect(resolveFutuProviderMarketSession(config, "unknown-job")).toBe("unknown-job");
  });

  it("uses a static market session when no per-job match exists", () => {
    writeConfig("static", "market_session: a_hk_daily\n");

    const config = loadFutuStockProviderConfig("static");

    expect(resolveFutuProviderMarketSession(config, "stock-market-premarket")).toBe("a_hk_daily");
  });

  it("rejects unsafe and reserved config names", () => {
    expect(() => getFutuStockProviderConfigPath("../secret")).toThrow(/path separators/);
    expect(() => getFutuStockProviderConfigPath("config")).toThrow(/reserved/);
  });
});
