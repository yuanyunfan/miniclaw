import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadMcpServers, resetMcpCache } from "../mcp.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "miniclaw-mcp-"));
  resetMcpCache();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.MINICLAW_MCP_CONFIG;
  delete process.env.MINICLAW_MCP_ALLOWLIST;
  resetMcpCache();
});

describe("loadMcpServers", () => {
  it("filters by allowlist", () => {
    const cfg = join(tmpDir, "config.json");
    writeFileSync(cfg, JSON.stringify({
      mcpServers: {
        exa: { type: "http", url: "https://exa.example/mcp" },
        context7: { type: "http", url: "https://context7.example" },
        kusto: { type: "stdio", command: "kusto-mcp" },
      },
    }));
    process.env.MINICLAW_MCP_CONFIG = cfg;
    process.env.MINICLAW_MCP_ALLOWLIST = "exa,context7";

    const servers = loadMcpServers();
    expect(Object.keys(servers).sort()).toEqual(["context7", "exa"]);
  });

  it("loads all servers when allowlist is wildcard", () => {
    const cfg = join(tmpDir, "config.json");
    writeFileSync(cfg, JSON.stringify({
      mcpServers: {
        exa: { type: "http", url: "https://exa.example/mcp" },
        context7: { type: "http", url: "https://context7.example" },
        kusto: { type: "stdio", command: "kusto-mcp" },
      },
    }));
    process.env.MINICLAW_MCP_CONFIG = cfg;
    process.env.MINICLAW_MCP_ALLOWLIST = "*";

    const servers = loadMcpServers();
    expect(Object.keys(servers).sort()).toEqual(["context7", "exa", "kusto"]);
  });

  it("returns empty object when config file missing", () => {
    process.env.MINICLAW_MCP_CONFIG = join(tmpDir, "missing.json");
    process.env.MINICLAW_MCP_ALLOWLIST = "exa";
    expect(loadMcpServers()).toEqual({});
  });

  it("returns empty object when JSON malformed", () => {
    const cfg = join(tmpDir, "broken.json");
    writeFileSync(cfg, "{ not json");
    process.env.MINICLAW_MCP_CONFIG = cfg;
    process.env.MINICLAW_MCP_ALLOWLIST = "exa";
    expect(loadMcpServers()).toEqual({});
  });

  it("returns empty when mcpServers key absent", () => {
    const cfg = join(tmpDir, "empty.json");
    writeFileSync(cfg, JSON.stringify({ unrelated: true }));
    process.env.MINICLAW_MCP_CONFIG = cfg;
    process.env.MINICLAW_MCP_ALLOWLIST = "exa";
    expect(loadMcpServers()).toEqual({});
  });
});
