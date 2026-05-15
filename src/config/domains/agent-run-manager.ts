import type { ConfigReader } from "../env.js";
import { DEFAULT_AGENT_RUN_MANAGER_POLICY } from "../../agent/run-manager/policy.js";

const DEFAULT_AGENT_RUN_MANAGER_ACP_CONFIG = {
  enabled: false,
  host: "127.0.0.1",
  port: 0,
  maxPayloadBytes: 256 * 1024,
  rateLimitWindowMs: 60_000,
  rateLimitMaxRequests: 120,
  traceExportEnabled: false,
  traceMaxEvents: 200,
  traceMaxBytes: 96_000,
};

export function buildAgentRunManagerRuntimeConfig(reader: ConfigReader) {
  return {
    enabled: reader.boolValue(
      ["agent_run_manager", "enabled"],
      "MINICLAW_AGENT_RUN_MANAGER_ENABLED",
      false
    ),
    autoEnabled: reader.boolValue(
      ["agent_run_manager", "auto_enabled"],
      "MINICLAW_AGENT_RUN_MANAGER_AUTO_ENABLED",
      false
    ),
    complexityMinScore: reader.nonNegativeInt(
      ["agent_run_manager", "complexity_min_score"],
      "MINICLAW_AGENT_RUN_MANAGER_COMPLEXITY_MIN_SCORE",
      4
    ),
    acp: {
      enabled: reader.boolValue(
        ["agent_run_manager", "acp", "enabled"],
        "MINICLAW_AGENT_RUN_MANAGER_ACP_ENABLED",
        DEFAULT_AGENT_RUN_MANAGER_ACP_CONFIG.enabled
      ),
      host: reader.requiredString(
        ["agent_run_manager", "acp", "host"],
        "MINICLAW_AGENT_RUN_MANAGER_ACP_HOST",
        DEFAULT_AGENT_RUN_MANAGER_ACP_CONFIG.host
      ),
      port: reader.nonNegativeInt(
        ["agent_run_manager", "acp", "port"],
        "MINICLAW_AGENT_RUN_MANAGER_ACP_PORT",
        DEFAULT_AGENT_RUN_MANAGER_ACP_CONFIG.port
      ),
      token: reader.optionalString(
        ["agent_run_manager", "acp", "token"],
        "MINICLAW_AGENT_RUN_MANAGER_ACP_TOKEN"
      ),
      maxPayloadBytes: reader.positiveInt(
        ["agent_run_manager", "acp", "max_payload_bytes"],
        "MINICLAW_AGENT_RUN_MANAGER_ACP_MAX_PAYLOAD_BYTES",
        DEFAULT_AGENT_RUN_MANAGER_ACP_CONFIG.maxPayloadBytes
      ),
      rateLimitWindowMs: reader.positiveInt(
        ["agent_run_manager", "acp", "rate_limit_window_ms"],
        "MINICLAW_AGENT_RUN_MANAGER_ACP_RATE_LIMIT_WINDOW_MS",
        DEFAULT_AGENT_RUN_MANAGER_ACP_CONFIG.rateLimitWindowMs
      ),
      rateLimitMaxRequests: reader.positiveInt(
        ["agent_run_manager", "acp", "rate_limit_max_requests"],
        "MINICLAW_AGENT_RUN_MANAGER_ACP_RATE_LIMIT_MAX_REQUESTS",
        DEFAULT_AGENT_RUN_MANAGER_ACP_CONFIG.rateLimitMaxRequests
      ),
      traceExportEnabled: reader.boolValue(
        ["agent_run_manager", "acp", "trace_export_enabled"],
        "MINICLAW_AGENT_RUN_MANAGER_ACP_TRACE_EXPORT_ENABLED",
        DEFAULT_AGENT_RUN_MANAGER_ACP_CONFIG.traceExportEnabled
      ),
      traceMaxEvents: reader.positiveInt(
        ["agent_run_manager", "acp", "trace_max_events"],
        "MINICLAW_AGENT_RUN_MANAGER_ACP_TRACE_MAX_EVENTS",
        DEFAULT_AGENT_RUN_MANAGER_ACP_CONFIG.traceMaxEvents
      ),
      traceMaxBytes: reader.positiveInt(
        ["agent_run_manager", "acp", "trace_max_bytes"],
        "MINICLAW_AGENT_RUN_MANAGER_ACP_TRACE_MAX_BYTES",
        DEFAULT_AGENT_RUN_MANAGER_ACP_CONFIG.traceMaxBytes
      ),
    },
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
