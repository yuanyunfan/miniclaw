import type { ConfigReader } from "../env.js";
import { DEFAULT_AGENT_RUN_MANAGER_POLICY } from "../../agent/run-manager/policy.js";

export function buildAgentRunManagerRuntimeConfig(reader: ConfigReader) {
  return {
    enabled: reader.boolValue(
      ["agent_run_manager", "enabled"],
      "MINICLAW_AGENT_RUN_MANAGER_ENABLED",
      false
    ),
    policy: {
      maxTurns: reader.positiveInt(
        ["agent_run_manager", "max_turns"],
        "MINICLAW_AGENT_RUN_MANAGER_MAX_TURNS",
        DEFAULT_AGENT_RUN_MANAGER_POLICY.maxTurns
      ),
      timeoutMs: reader.positiveInt(
        [["agent_run_manager", "timeout_ms"], ["agent_run_manager", "child_timeout_ms"]],
        ["MINICLAW_AGENT_RUN_MANAGER_TIMEOUT_MS", "MINICLAW_AGENT_RUN_MANAGER_CHILD_TIMEOUT_MS"],
        DEFAULT_AGENT_RUN_MANAGER_POLICY.timeoutMs
      ),
      maxMessages: reader.positiveInt(
        ["agent_run_manager", "max_messages"],
        "MINICLAW_AGENT_RUN_MANAGER_MAX_MESSAGES",
        DEFAULT_AGENT_RUN_MANAGER_POLICY.maxMessages
      ),
      maxArtifactBytes: reader.positiveInt(
        ["agent_run_manager", "max_artifact_bytes"],
        "MINICLAW_AGENT_RUN_MANAGER_MAX_ARTIFACT_BYTES",
        DEFAULT_AGENT_RUN_MANAGER_POLICY.maxArtifactBytes
      ),
      maxSpawnDepth: reader.nonNegativeInt(
        ["agent_run_manager", "max_spawn_depth"],
        "MINICLAW_AGENT_RUN_MANAGER_MAX_SPAWN_DEPTH",
        DEFAULT_AGENT_RUN_MANAGER_POLICY.maxSpawnDepth
      ),
      maxChildrenPerRun: reader.positiveInt(
        ["agent_run_manager", "max_children_per_run"],
        "MINICLAW_AGENT_RUN_MANAGER_MAX_CHILDREN_PER_RUN",
        DEFAULT_AGENT_RUN_MANAGER_POLICY.maxChildrenPerRun
      ),
      maxConcurrentRuns: reader.positiveInt(
        ["agent_run_manager", "max_concurrent_runs"],
        "MINICLAW_AGENT_RUN_MANAGER_MAX_CONCURRENT_RUNS",
        DEFAULT_AGENT_RUN_MANAGER_POLICY.maxConcurrentRuns
      ),
      maxPingPongTurns: reader.nonNegativeInt(
        ["agent_run_manager", "max_ping_pong_turns"],
        "MINICLAW_AGENT_RUN_MANAGER_MAX_PING_PONG_TURNS",
        DEFAULT_AGENT_RUN_MANAGER_POLICY.maxPingPongTurns
      ),
      cleanupTtlMs: reader.positiveInt(
        ["agent_run_manager", "cleanup_ttl_ms"],
        "MINICLAW_AGENT_RUN_MANAGER_CLEANUP_TTL_MS",
        DEFAULT_AGENT_RUN_MANAGER_POLICY.cleanupTtlMs
      ),
      maxFixIterations: reader.nonNegativeInt(
        ["agent_run_manager", "max_fix_iterations"],
        "MINICLAW_AGENT_RUN_MANAGER_MAX_FIX_ITERATIONS",
        DEFAULT_AGENT_RUN_MANAGER_POLICY.maxFixIterations
      ),
    },
  } as const;
}
