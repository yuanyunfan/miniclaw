import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEastmoneyMyfavorConfig, resolveEastmoneyMyfavorProfile } from "../config.js";

let tmp: string;
let previousConfig: string | undefined;
let previousAppkey: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-eastmoney-myfavor-config-"));
  previousConfig = process.env.MINICLAW_EASTMONEY_MYFAVOR_CONFIG;
  previousAppkey = process.env.MINICLAW_EASTMONEY_MYFAVOR_APPKEY;
  process.env.MINICLAW_EASTMONEY_MYFAVOR_CONFIG = join(tmp, "config.yaml");
  delete process.env.MINICLAW_EASTMONEY_MYFAVOR_APPKEY;
});

afterEach(() => {
  if (previousConfig === undefined) {
    delete process.env.MINICLAW_EASTMONEY_MYFAVOR_CONFIG;
  } else {
    process.env.MINICLAW_EASTMONEY_MYFAVOR_CONFIG = previousConfig;
  }
  if (previousAppkey === undefined) {
    delete process.env.MINICLAW_EASTMONEY_MYFAVOR_APPKEY;
  } else {
    process.env.MINICLAW_EASTMONEY_MYFAVOR_APPKEY = previousAppkey;
  }
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(yaml: string): void {
  writeFileSync(join(tmp, "config.yaml"), yaml);
}

describe("loadEastmoneyMyfavorConfig", () => {
  it("loads profiles and allows an empty appkey for disabled runtime sources", () => {
    writeConfig(`
profiles:
  default:
    account_alias: "Eastmoney Watchlist"
`);

    const profile = resolveEastmoneyMyfavorProfile(loadEastmoneyMyfavorConfig(), "default");

    expect(profile).toMatchObject({
      account_alias: "Eastmoney Watchlist",
      base_url: "https://myfavor.eastmoney.com",
      appkey: "",
      timeout_ms: 8000,
    });
    expect(profile.session_secret_path).toContain(".miniclaw/secrets/eastmoney-myfavor-session.json");
  });

  it("uses env appkey fallback without storing it in YAML", () => {
    process.env.MINICLAW_EASTMONEY_MYFAVOR_APPKEY = "from-env";
    writeConfig(`
profiles:
  default:
    account_alias: "Eastmoney Watchlist"
`);

    expect(resolveEastmoneyMyfavorProfile(loadEastmoneyMyfavorConfig(), "default").appkey).toBe("from-env");
  });

  it("rejects missing config files and unknown profiles", () => {
    expect(() => loadEastmoneyMyfavorConfig()).toThrow(/config not found/);

    writeConfig(`
profiles:
  default:
    account_alias: "Eastmoney Watchlist"
`);
    expect(() => resolveEastmoneyMyfavorProfile(loadEastmoneyMyfavorConfig(), "other")).toThrow(/profile not found/);
  });
});
