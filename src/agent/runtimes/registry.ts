import type { AgentProvider } from "../../config.js";
import type { AgentRuntime } from "../../runtime/agent-runtime.js";
import { claudeAgentRuntime } from "./claude-runtime.js";
import { codexAgentRuntime } from "./codex-runtime.js";

export type AgentRuntimeId = "claude" | "codex";

export interface DefaultAgentRuntimeConfig {
  agentProvider: AgentProvider;
  runtime?: {
    defaultAgent?: string;
    default_agent?: string;
  };
}

const agentRuntimes = {
  claude: claudeAgentRuntime,
  codex: codexAgentRuntime,
} as const satisfies Record<AgentRuntimeId, AgentRuntime>;

export function listAgentRuntimeIds(): AgentRuntimeId[] {
  return Object.keys(agentRuntimes) as AgentRuntimeId[];
}

export function isAgentRuntimeId(id: string): id is AgentRuntimeId {
  return Object.hasOwn(agentRuntimes, id);
}

export function getAgentRuntime(id: string): AgentRuntime {
  if (!isAgentRuntimeId(id)) {
    throw new Error(`Unknown agent runtime: ${id}`);
  }
  return agentRuntimes[id];
}

export function resolveDefaultAgentRuntimeId(config: DefaultAgentRuntimeConfig): AgentRuntimeId {
  const configured = config.runtime?.defaultAgent ?? config.runtime?.default_agent ?? config.agentProvider;
  if (!isAgentRuntimeId(configured)) {
    throw new Error(`Unknown default agent runtime: ${configured}`);
  }
  return configured;
}

export function getDefaultAgentRuntime(config: DefaultAgentRuntimeConfig): AgentRuntime {
  return getAgentRuntime(resolveDefaultAgentRuntimeId(config));
}
