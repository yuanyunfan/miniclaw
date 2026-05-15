export interface AgentRunManagerPolicy {
  maxTurns: number;
  timeoutMs: number;
  maxMessages: number;
  maxArtifactBytes: number;
  maxSpawnDepth: number;
  maxChildrenPerRun: number;
  maxConcurrentRuns: number;
  maxPingPongTurns: number;
  cleanupTtlMs: number;
  maxFixIterations: number;
}

export type AgentRunManagerPolicyInput = Partial<AgentRunManagerPolicy>;

export const DEFAULT_AGENT_RUN_MANAGER_POLICY: AgentRunManagerPolicy = {
  maxTurns: 12,
  timeoutMs: 1_800_000,
  maxMessages: 100,
  maxArtifactBytes: 1_000_000,
  maxSpawnDepth: 1,
  maxChildrenPerRun: 8,
  maxConcurrentRuns: 3,
  maxPingPongTurns: 8,
  cleanupTtlMs: 86_400_000,
  maxFixIterations: 2,
};

export function resolveAgentRunManagerPolicy(input: AgentRunManagerPolicyInput = {}): AgentRunManagerPolicy {
  return {
    ...DEFAULT_AGENT_RUN_MANAGER_POLICY,
    ...input,
  };
}
