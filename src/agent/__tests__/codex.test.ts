import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("codexThreadOptions", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.resetModules();
    tmpDir = mkdtempSync(join(tmpdir(), "miniclaw-codex-"));
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

  it("applies managed read-only role policy over default task sandbox", async () => {
    process.env.MINICLAW_CODEX_TASK_SANDBOX = "workspace-write";
    process.env.MINICLAW_CODEX_APPROVAL_POLICY = "on-request";

    const { codexThreadOptions } = await import("../codex.js");
    const { buildManagedRuntimeRolePolicy } = await import("../run-manager/role-policy.js");
    const opts = codexThreadOptions("task", "/tmp/project", {
      taskId: "task-codex-policy",
      runId: "run-planner",
      role: "planner",
      rolePolicy: buildManagedRuntimeRolePolicy({
        role: "planner",
        toolPolicyId: "read-only",
        canWriteWorkspace: false,
      }),
    });

    expect(opts).toMatchObject({
      sandboxMode: "read-only",
      approvalPolicy: "never",
      workingDirectory: "/tmp/project",
    });
  });

  it("applies managed generator workspace-write sandbox", async () => {
    process.env.MINICLAW_CODEX_TASK_SANDBOX = "read-only";

    const { codexThreadOptions } = await import("../codex.js");
    const { buildManagedRuntimeRolePolicy } = await import("../run-manager/role-policy.js");
    const opts = codexThreadOptions("task", "/tmp/project", {
      taskId: "task-codex-policy",
      runId: "run-generator",
      role: "generator",
      rolePolicy: buildManagedRuntimeRolePolicy({
        role: "generator",
        toolPolicyId: "workspace-write",
        canWriteWorkspace: true,
      }),
    });

    expect(opts).toMatchObject({
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
    });
  });
});

describe("codex managed Agent Bus overrides", () => {
  it("maps managed MCP context into Codex config overrides", async () => {
    const localTmp = mkdtempSync(join(tmpdir(), "miniclaw-codex-managed-"));
    const previous = {
      MINICLAW_CONFIG: process.env.MINICLAW_CONFIG,
      DISCORD_TOKEN: process.env.DISCORD_TOKEN,
      DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
      DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID,
      MINICLAW_ALLOWED_USER_ID: process.env.MINICLAW_ALLOWED_USER_ID,
    };
    try {
      vi.resetModules();
      const miniclawConfig = join(localTmp, "miniclaw.yaml");
      writeFileSync(miniclawConfig, "{}");
      process.env.MINICLAW_CONFIG = miniclawConfig;
      process.env.DISCORD_TOKEN = "test-token";
      process.env.DISCORD_CLIENT_ID = "test-client";
      process.env.DISCORD_GUILD_ID = "test-guild";
      process.env.MINICLAW_ALLOWED_USER_ID = "test-user";

      const { codexManagedAgentBusOverrides } = await import("../runners/codex-task-runner.js");
      const overrides = codexManagedAgentBusOverrides({
        taskId: "task-codex-bus",
        runId: "run-codex-child",
        role: "planner",
        agentBusMcp: {
          serverName: "miniclaw-agent-bus",
          serverConfig: {
            type: "stdio",
            command: "pnpm",
            args: ["--dir", "/repo/miniclaw", "run", "mcp:agent-bus"],
            env: { MINICLAW_AGENT_BUS_RUN_ID: "run-codex-child" },
          },
          allowedTools: ["mcp__miniclaw-agent-bus__post_message"],
          promptBlock: "live bus",
        },
      });

      expect(overrides).toEqual({
        config: {
          mcp_servers: {
            "miniclaw-agent-bus": {
              enabled: true,
              command: "pnpm",
              args: ["--dir", "/repo/miniclaw", "run", "mcp:agent-bus"],
              env: { MINICLAW_AGENT_BUS_RUN_ID: "run-codex-child" },
            },
          },
        },
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(localTmp, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it("detects managed role policy violations in Codex stream items", async () => {
    const localTmp = mkdtempSync(join(tmpdir(), "miniclaw-codex-managed-policy-"));
    const previous = {
      MINICLAW_CONFIG: process.env.MINICLAW_CONFIG,
      DISCORD_TOKEN: process.env.DISCORD_TOKEN,
      DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
      DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID,
      MINICLAW_ALLOWED_USER_ID: process.env.MINICLAW_ALLOWED_USER_ID,
    };
    try {
      vi.resetModules();
      const miniclawConfig = join(localTmp, "miniclaw.yaml");
      writeFileSync(miniclawConfig, "{}");
      process.env.MINICLAW_CONFIG = miniclawConfig;
      process.env.DISCORD_TOKEN = "test-token";
      process.env.DISCORD_CLIENT_ID = "test-client";
      process.env.DISCORD_GUILD_ID = "test-guild";
      process.env.MINICLAW_ALLOWED_USER_ID = "test-user";

      const { codexManagedRolePolicyViolation } = await import("../runners/codex-task-runner.js");
      const { buildManagedRuntimeRolePolicy } = await import("../run-manager/role-policy.js");
      const readOnlyContext = {
        taskId: "task-codex-policy",
        runId: "run-planner",
        role: "planner",
        rolePolicy: buildManagedRuntimeRolePolicy({
          role: "planner",
          toolPolicyId: "read-only",
          canWriteWorkspace: false,
        }),
      };
      const generatorContext = {
        taskId: "task-codex-policy",
        runId: "run-generator",
        role: "generator",
        rolePolicy: buildManagedRuntimeRolePolicy({
          role: "generator",
          toolPolicyId: "workspace-write",
          canWriteWorkspace: true,
        }),
      };

      expect(codexManagedRolePolicyViolation(readOnlyContext, { type: "file_change" })).toContain("read-only");
      expect(codexManagedRolePolicyViolation(generatorContext, {
        type: "command_execution",
        command: "git reset --hard HEAD",
      })).toContain("dangerous command");
      expect(codexManagedRolePolicyViolation(generatorContext, {
        type: "command_execution",
        command: "git status --short",
      })).toBeUndefined();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(localTmp, { recursive: true, force: true });
      vi.resetModules();
    }
  });
});
