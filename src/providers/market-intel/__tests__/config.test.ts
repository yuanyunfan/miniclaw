import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMarketIntelProviderConfigPath, loadMarketIntelProviderConfig } from "../config.js";

let tmp: string;
let previousConfigDir: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-market-intel-config-"));
  previousConfigDir = process.env.MINICLAW_MARKET_INTEL_PROVIDER_CONFIG_DIR;
  process.env.MINICLAW_MARKET_INTEL_PROVIDER_CONFIG_DIR = tmp;
});

afterEach(() => {
  if (previousConfigDir === undefined) {
    delete process.env.MINICLAW_MARKET_INTEL_PROVIDER_CONFIG_DIR;
  } else {
    process.env.MINICLAW_MARKET_INTEL_PROVIDER_CONFIG_DIR = previousConfigDir;
  }
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(name: string, yaml: string): void {
  writeFileSync(join(tmp, `${name}.yaml`), yaml);
}

describe("loadMarketIntelProviderConfig", () => {
  it("parses US pre-market config with defaults", () => {
    writeConfig("us-pre-market", `
market_scope: us
session: pre_market
timezone: America/New_York
portfolio_provider_config: us-stock
calendar:
  provider: static_plus_remote
  holidays:
    - "2026-01-01"
sources:
  quotes:
    us_primary: futu_opend
    fallback:
      - yahoo_chart_unofficial
  news:
    max_items: 25
watchlists:
  indices:
    - SPY
    - QQQ
quality:
  max_stale_minutes:
    quote: 15
`);

    const config = loadMarketIntelProviderConfig("us-pre-market");

    expect(config.market_scope).toBe("us");
    expect(config.session).toBe("pre_market");
    expect(config.portfolio_provider_config).toBe("us-stock");
    expect(config.markets.us?.timezone).toBe("America/New_York");
    expect(config.markets.us?.holidays).toContain("2026-01-01");
    expect(config.sources.quotes.us_primary).toBe("futu_opend");
    expect(config.sources.news.max_items).toBe(25);
    expect(config.watchlists.indices).toEqual(["SPY", "QQQ"]);
    expect(config.quality.max_stale_minutes.quote).toBe(15);
    expect(config.quality.allow_partial_news).toBe(true);
  });

  it("parses CN defaults and market-specific calendars", () => {
    writeConfig("cn-pre-market", `
market_scope: cn
session: pre_market
calendar:
  holidays:
    - "2026-05-01"
markets:
  hk:
    holidays:
      - "2026-05-25"
    early_closes:
      - date: "2026-12-24"
        close: "12:00"
`);

    const config = loadMarketIntelProviderConfig("cn-pre-market");

    expect(config.timezone).toBe("Asia/Shanghai");
    expect(config.markets["cn-a"]?.timezone).toBe("Asia/Shanghai");
    expect(config.markets.hk?.holidays).toEqual(["2026-05-01", "2026-05-25"]);
    expect(config.markets.hk?.early_closes).toEqual([{ date: "2026-12-24", close: "12:00" }]);
    expect(config.sources.quotes.cn_a_primary).toBe("eastmoney_public_fallback");
    expect(config.sources.quotes.hk_primary).toBe("futu_opend");
    expect(config.sources.macro.pboc).toBe("official_html");
  });

  it("rejects unsafe config names and invalid fields", () => {
    expect(() => getMarketIntelProviderConfigPath("../secret")).toThrow(/path separators/);
    expect(() => getMarketIntelProviderConfigPath("config")).toThrow(/reserved/);
    writeConfig("bad", `
market_scope: eu
session: pre_market
`);
    expect(() => loadMarketIntelProviderConfig("bad")).toThrow(/market_scope/);
  });
});
