import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEastmoneyJywgConfig, resolveEastmoneyJywgProfile } from "../config.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-eastmoney-config-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(yaml: string): string {
  const path = join(tmp, "config.yaml");
  writeFileSync(path, yaml);
  return path;
}

describe("loadEastmoneyJywgConfig", () => {
  it("returns a safe default profile when config is missing", () => {
    const config = loadEastmoneyJywgConfig(join(tmp, "missing.yaml"));

    expect(config.profiles.default).toMatchObject({
      base_url: "https://jywg.18.cn",
      account_alias: "default",
      redaction: "summary",
      include_orders: false,
      include_deals: false,
      allow_non_jywg_host: false,
    });
  });

  it("loads profiles and supports safe display overrides", () => {
    const path = writeConfig(`
profiles:
  default:
    account_alias: "Eastmoney A"
    session_secret_path: "~/custom/session.json"
    redaction: "summary"
    top_positions_limit: 5
`);

    const config = loadEastmoneyJywgConfig(path);
    const profile = resolveEastmoneyJywgProfile(config, "default", { account_alias: "Daily", redaction: "exact" });

    expect(profile.account_alias).toBe("Daily");
    expect(profile.redaction).toBe("exact");
    expect(profile.top_positions_limit).toBe(5);
  });

  it("rejects unsafe profile names and non-jywg base URLs", () => {
    const unsafeName = writeConfig(`
profiles:
  "../secret":
    account_alias: "bad"
`);
    expect(() => loadEastmoneyJywgConfig(unsafeName)).toThrow(/profile names/);

    const unsafeHost = writeConfig(`
profiles:
  default:
    base_url: "https://example.com"
`);
    expect(() => loadEastmoneyJywgConfig(unsafeHost)).toThrow(/base_url/);
  });
});
