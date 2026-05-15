import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentTaskManagedContext, AgentTaskManagedRuntimePolicy, AgentTaskMcpServerConfig } from "../../../runtime/agent-runtime.js";
import type { AgentRunManagerPolicy } from "../policy.js";
import { managedRuntimePolicyEnv } from "../role-policy.js";

export const AGENT_BUS_MCP_SERVER_NAME = "miniclaw-agent-bus";
export const AGENT_BUS_MCP_TOOL_NAMES = [
  "post_message",
  "read_mailbox",
  "write_artifact",
  "read_artifact",
  "list_blackboard",
  "upsert_blackboard_fact",
] as const;

export interface AgentBusMcpRuntimeContextInput {
  taskId: string;
  runId: string;
  role: string;
  cwd: string;
  policy: Pick<AgentRunManagerPolicy, "maxMessages" | "maxArtifactBytes" | "maxPingPongTurns">;
  rolePolicy?: AgentTaskManagedRuntimePolicy;
  repoRoot?: string;
}

function defaultRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}

export function createAgentBusMcpEnv(input: Omit<AgentBusMcpRuntimeContextInput, "role" | "repoRoot">): Record<string, string> {
  return {
    MINICLAW_AGENT_BUS_TASK_ID: input.taskId,
    MINICLAW_AGENT_BUS_RUN_ID: input.runId,
    MINICLAW_AGENT_BUS_CWD: input.cwd,
    MINICLAW_AGENT_RUN_MANAGER_MAX_MESSAGES: String(input.policy.maxMessages),
    MINICLAW_AGENT_RUN_MANAGER_MAX_ARTIFACT_BYTES: String(input.policy.maxArtifactBytes),
    MINICLAW_AGENT_RUN_MANAGER_MAX_PING_PONG_TURNS: String(input.policy.maxPingPongTurns),
    ...(input.rolePolicy ? managedRuntimePolicyEnv(input.rolePolicy) : {}),
  };
}

export function createAgentBusMcpServerConfig(input: AgentBusMcpRuntimeContextInput): AgentTaskMcpServerConfig {
  return {
    type: "stdio",
    command: "pnpm",
    args: ["--dir", input.repoRoot ?? defaultRepoRoot(), "run", "mcp:agent-bus"],
    env: createAgentBusMcpEnv(input),
  };
}

export function createAgentBusAllowedToolNames(serverName = AGENT_BUS_MCP_SERVER_NAME): string[] {
  return AGENT_BUS_MCP_TOOL_NAMES.map((tool) => `mcp__${serverName}__${tool}`);
}

export function createAgentBusPromptBlock(input: {
  serverName?: string;
  taskId: string;
  runId: string;
  role: string;
  rolePolicy?: AgentTaskManagedRuntimePolicy;
}): string {
  const serverName = input.serverName ?? AGENT_BUS_MCP_SERVER_NAME;
  return [
    "MiniClaw live Agent Bus MCP tools are available for this managed child run.",
    `Current task_id: ${input.taskId}`,
    `Current run_id: ${input.runId}`,
    `Current role: ${input.role}`,
    ...(input.rolePolicy
      ? [
          `Tool policy: ${input.rolePolicy.toolPolicyId}`,
          `Workspace write allowed: ${input.rolePolicy.canWriteWorkspace ? "yes" : "no"}`,
        ]
      : []),
    `MCP server: ${serverName}`,
    `Available tool names: ${createAgentBusAllowedToolNames(serverName).join(", ")}`,
    "Use these tools during execution to post typed messages, publish artifacts, read mailbox/artifacts, and update the task blackboard.",
    "Still include the final miniclaw_agent_envelope fallback in your final response so older runtimes and traces remain compatible.",
  ].join("\n");
}

export function createManagedAgentBusContext(input: AgentBusMcpRuntimeContextInput): AgentTaskManagedContext {
  return {
    taskId: input.taskId,
    runId: input.runId,
    role: input.role,
    ...(input.rolePolicy ? { rolePolicy: input.rolePolicy } : {}),
    agentBusMcp: {
      serverName: AGENT_BUS_MCP_SERVER_NAME,
      serverConfig: createAgentBusMcpServerConfig(input),
      allowedTools: createAgentBusAllowedToolNames(),
      promptBlock: createAgentBusPromptBlock(input),
    },
  };
}
