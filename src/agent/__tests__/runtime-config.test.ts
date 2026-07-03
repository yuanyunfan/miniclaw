import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentRuntimeSummary } from "../runtime-config.js";

let tmpDir: string;

beforeEach(() => {
  vi.resetModules();
  tmpDir = mkdtempSync(join(tmpdir(), "miniclaw-runtime-config-"));
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
  vi.resetModules();
});

describe("formatAgentRuntimeSummary", () => {
  it("renders only safe names for MCP and skills", async () => {
    const { formatAgentRuntimeSummary } = await import("../runtime-config.js");
    const summary: AgentRuntimeSummary = {
      config: {
        filePath: "/home/miniclaw/.miniclaw/config.yaml",
        fileLoaded: true,
        mcpConfigPath: "/home/miniclaw/.claude.json",
        mcpAllowlist: ["exa", "context7"],
      },
      provider: "codex",
      model: "inherit",
      runtime: {
        defaultAgent: "codex",
      },
      agentRunManager: {
        modelRoutingEnabled: true,
        modelRoutingRoles: ["generator:codex/gpt-5-mini", "planner:codex/gpt-5.5"],
        escalationEnabled: true,
        escalationRoles: ["generator"],
      },
      modelClient: {
        defaultClient: "openai",
        smartRouterClient: "openai_compatible",
      },
      transport: {
        defaultTransport: "discord",
        implemented: ["discord"],
      },
      dataProviders: {
        preProviders: ["email-query", "wechat-mp"],
      },
      defaultCwd: "/home/miniclaw/ProjectRepo",
      codex: {
        cliPath: "/opt/homebrew/bin/codex",
        model: "inherit",
        reasoningEffort: "inherit",
        taskSandbox: "inherit",
        chatSandbox: "read-only",
        approvalPolicy: "inherit",
        webSearchMode: "inherit",
        networkAccess: "inherit",
        mcpServers: ["github", "kusto"],
        skills: ["daily-ai-usage"],
      },
      claude: {
        model: "claude-opus-4-7",
        settingSources: ["user", "project", "local"],
        hooks: "disabled",
        mcpServers: ["exa", "context7"],
        skills: ["weixin"],
        agents: ["code-reviewer"],
      },
      miniclaw: {
        skills: ["cost-report"],
      },
    };

    const text = formatAgentRuntimeSummary(summary);
    expect(text).toContain("AgentRuntime: `codex` / Model: `inherit`");
    expect(text).toContain("Managed model routing: enabled roles=`generator:codex/gpt-5-mini`, `planner:codex/gpt-5.5`");
    expect(text).toContain("Managed escalation: enabled roles=`generator`");
    expect(text).toContain("Legacy provider alias: `codex`");
    expect(text).toContain("ModelClient: default=`openai` smart-router=`openai_compatible`");
    expect(text).toContain("IMTransport: default=`discord` implemented=`discord`");
    expect(text).toContain("Data providers: `email-query`, `wechat-mp`");
    expect(text).toContain("Config: `/home/miniclaw/.miniclaw/config.yaml` (loaded)");
    expect(text).toContain("MCP config=`/home/miniclaw/.claude.json` allowlist=`exa,context7`");
    expect(text).toContain("MCP: `github`, `kusto`");
    expect(text).toContain("MCP loaded by MiniClaw: `exa`, `context7`");
    expect(text).not.toContain("url");
    expect(text).not.toContain("token");
    expect(text).not.toContain("command");
  });
});
