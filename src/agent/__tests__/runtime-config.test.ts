import { describe, expect, it } from "vitest";
import { formatAgentRuntimeSummary, type AgentRuntimeSummary } from "../runtime-config.js";

describe("formatAgentRuntimeSummary", () => {
  it("renders only safe names for MCP and skills", () => {
    const summary: AgentRuntimeSummary = {
      provider: "codex",
      model: "inherit",
      defaultCwd: "/Users/yuan/ProjectRepo",
      codex: {
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
    expect(text).toContain("Provider: `codex` / Model: `inherit`");
    expect(text).toContain("MCP: `github`, `kusto`");
    expect(text).toContain("MCP loaded by MiniClaw: `exa`, `context7`");
    expect(text).not.toContain("url");
    expect(text).not.toContain("token");
    expect(text).not.toContain("command");
  });
});
