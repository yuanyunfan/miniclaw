import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEastmoneyEtfPremiumProviderConfigPath, loadEastmoneyEtfPremiumProviderConfig } from "../config.js";

let tmp: string;
let previousConfigDir: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-eastmoney-etf-premium-config-"));
  previousConfigDir = process.env.MINICLAW_EASTMONEY_ETF_PREMIUM_CONFIG_DIR;
  process.env.MINICLAW_EASTMONEY_ETF_PREMIUM_CONFIG_DIR = tmp;
});

afterEach(() => {
  if (previousConfigDir === undefined) {
    delete process.env.MINICLAW_EASTMONEY_ETF_PREMIUM_CONFIG_DIR;
  } else {
    process.env.MINICLAW_EASTMONEY_ETF_PREMIUM_CONFIG_DIR = previousConfigDir;
  }
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(name: string, yaml: string): void {
  writeFileSync(join(tmp, `${name}.yaml`), yaml);
}

describe("loadEastmoneyEtfPremiumProviderConfig", () => {
  it("parses ETF symbols and request options", () => {
    writeConfig("cn-stock", `
timeout_ms: 5000
concurrency: 2
symbols:
  - code: "159513"
    name: 纳指大成
  - "159632"
`);

    expect(loadEastmoneyEtfPremiumProviderConfig("cn-stock")).toEqual({
      timeout_ms: 5000,
      concurrency: 2,
      symbols: [
        { code: "159513", name: "纳指大成" },
        { code: "159632", name: undefined },
      ],
    });
  });

  it("rejects unsafe config names and malformed symbols", () => {
    expect(() => getEastmoneyEtfPremiumProviderConfigPath("../secret")).toThrow(/path separators/);
    expect(() => getEastmoneyEtfPremiumProviderConfigPath("config")).toThrow(/reserved/);
    writeConfig("bad", "symbols:\n  - code: abc\n");
    expect(() => loadEastmoneyEtfPremiumProviderConfig("bad")).toThrow(/6-digit/);
  });
});
