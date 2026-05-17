import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMarketContextProviderConfigPath, loadMarketContextProviderConfig } from "../config.js";

let tmp: string;
let previousConfigDir: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-market-context-config-"));
  previousConfigDir = process.env.MINICLAW_MARKET_CONTEXT_PROVIDER_CONFIG_DIR;
  process.env.MINICLAW_MARKET_CONTEXT_PROVIDER_CONFIG_DIR = tmp;
});

afterEach(() => {
  if (previousConfigDir === undefined) {
    delete process.env.MINICLAW_MARKET_CONTEXT_PROVIDER_CONFIG_DIR;
  } else {
    process.env.MINICLAW_MARKET_CONTEXT_PROVIDER_CONFIG_DIR = previousConfigDir;
  }
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(name: string, yaml: string): void {
  writeFileSync(join(tmp, `${name}.yaml`), yaml);
}

describe("loadMarketContextProviderConfig", () => {
  it("parses update config with defaults", () => {
    writeConfig("us-update", `
mode: update
market_scope: us
forecast_session: pre_market
max_items: 20
`);

    const config = loadMarketContextProviderConfig("us-update");

    expect(config.mode).toBe("update");
    expect(config.market_scope).toBe("us");
    expect(config.market_scopes).toEqual(["us"]);
    expect(config.timezone).toBe("America/New_York");
    expect(config.max_items).toBe(20);
    expect(config.max_digest_chars).toBe(1800);
  });

  it("parses inject config for multiple scopes", () => {
    writeConfig("stock-inject", `
mode: inject
market_scopes:
  - us
  - cross-market
max_items: 8
`);

    const config = loadMarketContextProviderConfig("stock-inject");

    expect(config.mode).toBe("inject");
    expect(config.market_scope).toBeUndefined();
    expect(config.market_scopes).toEqual(["us", "cross-market"]);
    expect(config.max_items).toBe(8);
  });

  it("rejects unsafe config names and invalid update configs", () => {
    expect(() => getMarketContextProviderConfigPath("../secret")).toThrow(/path separators/);
    expect(() => getMarketContextProviderConfigPath("config")).toThrow(/reserved/);
    writeConfig("bad-update", `
mode: update
market_scopes:
  - us
`);
    expect(() => loadMarketContextProviderConfig("bad-update")).toThrow(/requires market_scope/);
  });
});
