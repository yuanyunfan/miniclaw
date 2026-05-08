import { describe, expect, it } from "vitest";
import { createEastmoneyJywgMcpServer } from "../server.js";
import { EASTMONEY_JYWG_TOOL_NAMES } from "../safety.js";

describe("eastmoney-jywg MCP server", () => {
  it("creates a server with read-only tool names", () => {
    expect(() => createEastmoneyJywgMcpServer()).not.toThrow();
    for (const name of EASTMONEY_JYWG_TOOL_NAMES) {
      expect(name).not.toMatch(/order|trade|buy|sell|cancel|revoke|submit|ipo|unlock/i);
    }
  });
});
