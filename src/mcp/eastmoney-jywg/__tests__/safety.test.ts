import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertAllowedToolName,
  buildEndpointUrl,
  EASTMONEY_JYWG_TOOL_NAMES,
  FORBIDDEN_EASTMONEY_JYWG_ENDPOINTS,
} from "../safety.js";
import type { EastmoneyJywgProfileConfig } from "../types.js";

const profile: EastmoneyJywgProfileConfig = {
  account_alias: "Eastmoney A",
  base_url: "https://jywg.18.cn",
  session_secret_path: "~/.miniclaw/secrets/eastmoney-jywg-session.json",
  browser_profile_dir: "~/.miniclaw/browser-profiles/eastmoney-jywg",
  snapshot_dir: "~/.miniclaw/providers/eastmoney-jywg-readonly/snapshots",
  redaction: "summary",
  top_positions_limit: 8,
  include_orders: false,
  include_deals: false,
  allow_non_jywg_host: false,
  fail_on_login_challenge: true,
  show_total_assets: false,
};

const FILES_TO_SCAN = [
  "client.ts",
  "config.ts",
  "mapper.ts",
  "redact.ts",
  "server.ts",
  "session-vault.ts",
  "types.ts",
];

describe("eastmoney-jywg safety", () => {
  it("only exposes read-only tool names", () => {
    expect(EASTMONEY_JYWG_TOOL_NAMES).toEqual([
      "eastmoney_jywg_health_check",
      "eastmoney_jywg_get_account_snapshot",
      "eastmoney_jywg_get_positions_summary",
      "eastmoney_jywg_get_daily_pnl_report",
    ]);
    for (const name of EASTMONEY_JYWG_TOOL_NAMES) {
      expect(() => assertAllowedToolName(name)).not.toThrow();
      expect(name).not.toMatch(/order|trade|buy|sell|cancel|revoke|submit|ipo|unlock/i);
    }
  });

  it("builds only hard-coded jywg read-only endpoint URLs", () => {
    const url = buildEndpointUrl(profile, "query_asset_and_position", "abc");

    expect(url.href).toBe("https://jywg.18.cn/Com/queryAssetAndPositionV1?validatekey=abc");
  });

  it("does not call forbidden trading endpoints outside the central safety list", () => {
    const root = join(process.cwd(), "src/mcp/eastmoney-jywg");
    for (const file of FILES_TO_SCAN) {
      const text = readFileSync(join(root, file), "utf8");
      for (const forbidden of FORBIDDEN_EASTMONEY_JYWG_ENDPOINTS) {
        expect(text, `${file} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
