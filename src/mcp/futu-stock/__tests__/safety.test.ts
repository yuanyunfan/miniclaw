import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertAllowedToolName, assertSafeOpendHost, FORBIDDEN_FUTU_API_NAMES, FUTU_STOCK_TOOL_NAMES } from "../safety.js";
import type { FutuStockProfileConfig } from "../types.js";

const baseProfile: FutuStockProfileConfig = {
  opend_host: "127.0.0.1",
  opend_port: 11111,
  account_alias: "Futu HK",
  currency: "HKD",
  redaction: "summary",
  snapshot_dir: "~/.miniclaw/providers/futu-stock/snapshots",
  python_bin: "python3",
  trd_market: "HK",
  security_firm: "FUTUSECURITIES",
  allow_non_local_opend: false,
  show_total_assets: false,
};

const FILES_TO_SCAN = [
  "server.ts",
  "futu-client.ts",
  "mapper.ts",
  "redact.ts",
  "config.ts",
  "state.ts",
  "types.ts",
];

describe("futu-stock safety", () => {
  it("only exposes the intended read-only tool names", () => {
    expect(FUTU_STOCK_TOOL_NAMES).toEqual([
      "futu_health_check",
      "futu_get_account_snapshot",
      "futu_get_positions_summary",
      "futu_get_daily_pnl_report",
    ]);
    for (const name of FUTU_STOCK_TOOL_NAMES) {
      expect(() => assertAllowedToolName(name)).not.toThrow();
      expect(name).not.toMatch(/unlock|order|buy|sell/i);
    }
  });

  it("refuses non-local OpenD hosts by default", () => {
    expect(() => assertSafeOpendHost({ ...baseProfile, opend_host: "192.168.1.10" })).toThrow(/non-local OpenD/);
    expect(() => assertSafeOpendHost({ ...baseProfile, opend_host: "192.168.1.10", allow_non_local_opend: true })).not.toThrow();
  });

  it("does not call forbidden trading APIs outside the central safety list", () => {
    const root = join(process.cwd(), "src/mcp/futu-stock");
    for (const file of FILES_TO_SCAN) {
      const text = readFileSync(join(root, file), "utf8");
      for (const forbidden of FORBIDDEN_FUTU_API_NAMES) {
        expect(text, `${file} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
