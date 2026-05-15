import { describe, expect, it } from "vitest";
import {
  AGENT_BUS_MCP_SERVER_NAME,
  createAgentBusAllowedToolNames,
  createAgentBusMcpEnv,
  createAgentBusMcpServerConfig,
  createManagedAgentBusContext,
} from "../injection.js";
import { buildManagedRuntimeRolePolicy } from "../../role-policy.js";

describe("Agent Bus MCP injection", () => {
  it("builds stdio MCP server config and prompt context for a managed child run", () => {
    const policy = { maxMessages: 11, maxArtifactBytes: 22, maxPingPongTurns: 3 };
    const rolePolicy = buildManagedRuntimeRolePolicy({
      role: "generator",
      toolPolicyId: "workspace-write",
      canWriteWorkspace: true,
    });
    const env = createAgentBusMcpEnv({
      taskId: "task-live-bus",
      runId: "run-generator",
      cwd: "/tmp/miniclaw-work",
      policy,
      rolePolicy,
    });
    expect(env).toMatchObject({
      MINICLAW_AGENT_BUS_TASK_ID: "task-live-bus",
      MINICLAW_AGENT_BUS_RUN_ID: "run-generator",
      MINICLAW_AGENT_BUS_CWD: "/tmp/miniclaw-work",
      MINICLAW_AGENT_RUN_MANAGER_MAX_MESSAGES: "11",
      MINICLAW_AGENT_RUN_MANAGER_MAX_ARTIFACT_BYTES: "22",
      MINICLAW_AGENT_RUN_MANAGER_MAX_PING_PONG_TURNS: "3",
      MINICLAW_AGENT_RUN_MANAGER_TOOL_POLICY_ID: "workspace-write",
      MINICLAW_AGENT_RUN_MANAGER_CAN_WRITE_WORKSPACE: "true",
      MINICLAW_AGENT_RUN_MANAGER_CODEX_SANDBOX: "workspace-write",
      MINICLAW_AGENT_RUN_MANAGER_CODEX_APPROVAL_POLICY: "never",
      MINICLAW_AGENT_RUN_MANAGER_CLAUDE_PERMISSION_MODE: "acceptEdits",
    });

    const serverConfig = createAgentBusMcpServerConfig({
      taskId: "task-live-bus",
      runId: "run-generator",
      role: "generator",
      cwd: "/tmp/miniclaw-work",
      policy,
      rolePolicy,
      repoRoot: "/repo/miniclaw",
    });
    expect(serverConfig).toEqual({
      type: "stdio",
      command: "pnpm",
      args: ["--dir", "/repo/miniclaw", "run", "mcp:agent-bus"],
      env,
    });

    const managedContext = createManagedAgentBusContext({
      taskId: "task-live-bus",
      runId: "run-generator",
      role: "generator",
      cwd: "/tmp/miniclaw-work",
      policy,
      rolePolicy,
      repoRoot: "/repo/miniclaw",
    });
    expect(managedContext.agentBusMcp).toMatchObject({
      serverName: AGENT_BUS_MCP_SERVER_NAME,
      serverConfig,
      allowedTools: createAgentBusAllowedToolNames(),
    });
    expect(managedContext.rolePolicy).toMatchObject({ toolPolicyId: "workspace-write", canWriteWorkspace: true });
    expect(managedContext.agentBusMcp?.promptBlock).toContain("Current run_id: run-generator");
    expect(managedContext.agentBusMcp?.promptBlock).toContain("Workspace write allowed: yes");
    expect(managedContext.agentBusMcp?.promptBlock).toContain("mcp__miniclaw-agent-bus__post_message");
  });
});
