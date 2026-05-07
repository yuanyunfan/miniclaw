import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("codexThreadOptions", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MINICLAW_AGENT_PROVIDER = "codex";
    process.env.DISCORD_TOKEN = "test-token";
    process.env.DISCORD_CLIENT_ID = "test-client";
    process.env.DISCORD_GUILD_ID = "test-guild";
    process.env.MINICLAW_ALLOWED_USER_ID = "test-user";
  });

  afterEach(() => {
    delete process.env.MINICLAW_CODEX_MODEL;
    delete process.env.MINICLAW_CODEX_REASONING_EFFORT;
    delete process.env.MINICLAW_CODEX_TASK_SANDBOX;
    delete process.env.MINICLAW_CODEX_CHAT_SANDBOX;
    delete process.env.MINICLAW_CODEX_APPROVAL_POLICY;
    delete process.env.MINICLAW_CODEX_WEB_SEARCH;
    delete process.env.MINICLAW_CODEX_NETWORK_ACCESS;
    vi.resetModules();
  });

  it("omits inherited settings so Codex CLI can load local config", async () => {
    process.env.MINICLAW_CODEX_MODEL = "inherit";
    process.env.MINICLAW_CODEX_REASONING_EFFORT = "inherit";
    process.env.MINICLAW_CODEX_TASK_SANDBOX = "inherit";
    process.env.MINICLAW_CODEX_APPROVAL_POLICY = "inherit";
    process.env.MINICLAW_CODEX_WEB_SEARCH = "inherit";
    process.env.MINICLAW_CODEX_NETWORK_ACCESS = "inherit";

    const { codexThreadOptions } = await import("../codex.js");
    const opts = codexThreadOptions("task", "/tmp/project");

    expect(opts).toMatchObject({
      skipGitRepoCheck: true,
      workingDirectory: "/tmp/project",
    });
    expect(opts).not.toHaveProperty("model");
    expect(opts).not.toHaveProperty("sandboxMode");
    expect(opts).not.toHaveProperty("approvalPolicy");
    expect(opts).not.toHaveProperty("modelReasoningEffort");
    expect(opts).not.toHaveProperty("webSearchMode");
    expect(opts).not.toHaveProperty("networkAccessEnabled");
  });

  it("keeps explicit MiniClaw overrides when not inherited", async () => {
    process.env.MINICLAW_CODEX_MODEL = "gpt-5.5";
    process.env.MINICLAW_CODEX_REASONING_EFFORT = "high";
    process.env.MINICLAW_CODEX_TASK_SANDBOX = "workspace-write";
    process.env.MINICLAW_CODEX_APPROVAL_POLICY = "never";
    process.env.MINICLAW_CODEX_WEB_SEARCH = "live";
    process.env.MINICLAW_CODEX_NETWORK_ACCESS = "true";

    const { codexThreadOptions } = await import("../codex.js");
    const opts = codexThreadOptions("task", "/tmp/project");

    expect(opts).toMatchObject({
      model: "gpt-5.5",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      modelReasoningEffort: "high",
      webSearchMode: "live",
      networkAccessEnabled: true,
      workingDirectory: "/tmp/project",
    });
  });
});
