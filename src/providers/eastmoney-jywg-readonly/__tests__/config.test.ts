import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getEastmoneyJywgProviderConfigPath,
  loadEastmoneyJywgProviderConfig,
  resolveEastmoneyJywgProviderMarketSession,
} from "../config.js";

let tmp: string;
let previousConfigDir: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-eastmoney-provider-config-"));
  previousConfigDir = process.env.MINICLAW_EASTMONEY_JYWG_PROVIDER_CONFIG_DIR;
  process.env.MINICLAW_EASTMONEY_JYWG_PROVIDER_CONFIG_DIR = tmp;
});

afterEach(() => {
  if (previousConfigDir === undefined) {
    delete process.env.MINICLAW_EASTMONEY_JYWG_PROVIDER_CONFIG_DIR;
  } else {
    process.env.MINICLAW_EASTMONEY_JYWG_PROVIDER_CONFIG_DIR = previousConfigDir;
  }
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(name: string, yaml: string): void {
  writeFileSync(join(tmp, `${name}.yaml`), yaml);
}

describe("loadEastmoneyJywgProviderConfig", () => {
  it("parses provider defaults and per-job market sessions", () => {
    writeConfig("daily-stock-market", `
profile: default
account_alias: Eastmoney A
redaction: summary
top_positions_limit: 6
market_session_by_job:
  stock-market-premarket: premarket_0915
  a-share-hk-postmarket: a_hk_postmarket_1515
`);

    const config = loadEastmoneyJywgProviderConfig("daily-stock-market");

    expect(config).toMatchObject({
      profile: "default",
      account_alias: "Eastmoney A",
      redaction: "summary",
      top_positions_limit: 6,
      include_account_snapshot: true,
      include_daily_report: true,
      include_positions_summary: true,
    });
    expect(resolveEastmoneyJywgProviderMarketSession(config, "stock-market-premarket")).toBe("premarket_0915");
    expect(resolveEastmoneyJywgProviderMarketSession(config, "unknown-job")).toBe("unknown-job");
  });

  it("rejects unsafe and reserved config names", () => {
    expect(() => getEastmoneyJywgProviderConfigPath("../secret")).toThrow(/path separators/);
    expect(() => getEastmoneyJywgProviderConfigPath("config")).toThrow(/reserved/);
  });
});
