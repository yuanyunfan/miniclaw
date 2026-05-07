import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

beforeEach(() => {
  vi.resetModules();
  tmpDir = mkdtempSync(join(tmpdir(), "miniclaw-mcp-"));
  const miniclawConfig = join(tmpDir, "miniclaw.yaml");
  writeFileSync(miniclawConfig, "{}");
  process.env.MINICLAW_CONFIG = miniclawConfig;
  process.env.MINICLAW_AGENT_PROVIDER = "codex";
  process.env.DISCORD_TOKEN = "test-token";
  process.env.DISCORD_CLIENT_ID = "test-client";
  process.env.DISCORD_GUILD_ID = "test-guild";
  process.env.MINICLAW_ALLOWED_USER_ID = "test-user";
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.MINICLAW_CONFIG;
  delete process.env.MINICLAW_AGENT_PROVIDER;
  delete process.env.DISCORD_TOKEN;
  delete process.env.DISCORD_CLIENT_ID;
  delete process.env.DISCORD_GUILD_ID;
  delete process.env.MINICLAW_ALLOWED_USER_ID;
  delete process.env.MINICLAW_MCP_CONFIG;
  delete process.env.MINICLAW_MCP_ALLOWLIST;
  vi.resetModules();
});

describe("loadMcpServers", () => {
  it("filters by allowlist", async () => {
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

    const { loadMcpServers } = await import("../mcp.js");
    const servers = loadMcpServers();
    expect(Object.keys(servers).sort()).toEqual(["context7", "exa"]);
  });

  it("loads all servers when allowlist is wildcard", async () => {
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

    const { loadMcpServers } = await import("../mcp.js");
    const servers = loadMcpServers();
    expect(Object.keys(servers).sort()).toEqual(["context7", "exa", "kusto"]);
  });

  it("returns empty object when config file missing", async () => {
    process.env.MINICLAW_MCP_CONFIG = join(tmpDir, "missing.json");
    process.env.MINICLAW_MCP_ALLOWLIST = "exa";
    const { loadMcpServers } = await import("../mcp.js");
    expect(loadMcpServers()).toEqual({});
  });

  it("returns empty object when JSON malformed", async () => {
    const cfg = join(tmpDir, "broken.json");
    writeFileSync(cfg, "{ not json");
    process.env.MINICLAW_MCP_CONFIG = cfg;
    process.env.MINICLAW_MCP_ALLOWLIST = "exa";
    const { loadMcpServers } = await import("../mcp.js");
    expect(loadMcpServers()).toEqual({});
  });

  it("returns empty when mcpServers key absent", async () => {
    const cfg = join(tmpDir, "empty.json");
    writeFileSync(cfg, JSON.stringify({ unrelated: true }));
    process.env.MINICLAW_MCP_CONFIG = cfg;
    process.env.MINICLAW_MCP_ALLOWLIST = "exa";
    const { loadMcpServers } = await import("../mcp.js");
    expect(loadMcpServers()).toEqual({});
  });
});
