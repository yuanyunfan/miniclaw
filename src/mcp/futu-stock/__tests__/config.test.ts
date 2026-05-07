import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFutuStockConfig, resolveFutuStockProfile } from "../config.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-futu-config-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(yaml: string): string {
  const path = join(tmp, "config.yaml");
  writeFileSync(path, yaml);
  return path;
}

describe("loadFutuStockConfig", () => {
  it("returns a localhost-only default profile when config is missing", () => {
    const config = loadFutuStockConfig(join(tmp, "missing.yaml"));

    expect(config.profiles.default).toMatchObject({
      opend_host: "127.0.0.1",
      opend_port: 11111,
      account_alias: "default",
      redaction: "summary",
      allow_non_local_opend: false,
    });
  });

  it("loads profiles and supports safe display overrides", () => {
    const path = writeConfig(`
profiles:
  hk:
    opend_host: "127.0.0.1"
    opend_port: 11111
    account_alias: "Futu HK"
    currency: "HKD"
    redaction: "summary"
    python_bin: "python3"
    trd_market: "HK"
    security_firm: "FUTUSECURITIES"
    acc_index: 0
`);

    const config = loadFutuStockConfig(path);
    const profile = resolveFutuStockProfile(config, "hk", { account_alias: "Daily", redaction: "exact" });

    expect(profile.account_alias).toBe("Daily");
    expect(profile.redaction).toBe("exact");
    expect(profile.acc_index).toBe(0);
  });

  it("rejects unsafe profile names", () => {
    const path = writeConfig(`
profiles:
  "../secret":
    opend_host: "127.0.0.1"
`);

    expect(() => loadFutuStockConfig(path)).toThrow(/profile names/);
  });
});
