import type { ConfigReader } from "../env.js";
import {
  agentProviderValues,
  codexReasoningEffortValues,
  isPlainObject,
} from "../schema.js";
import type { AgentProvider, CodexReasoningEffort, ConfigPath } from "../types.js";
import { DEFAULT_AGENT_RUN_MANAGER_POLICY } from "../../agent/run-manager/policy.js";
import type {
  AgentRunManagerModelRoutingConfig,
  AgentRunManagerRoleModelOverride,
} from "../../agent/run-manager/model-routing.js";

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

const MODEL_ROUTING_KNOWN_ROLES = ["planner", "researcher", "generator", "evaluator", "final-synthesizer"] as const;

function envPrefixForRole(role: string): string {
  return `MINICLAW_AGENT_RUN_MANAGER_${role.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

function parseStringOrInherit(raw: unknown, label: string, reader: ConfigReader): string | undefined {
  const value = reader.scalarString(raw, label);
  if (!value) return undefined;
  return value.toLowerCase() === "inherit" ? undefined : value;
}

function parseProvider(raw: unknown, label: string, reader: ConfigReader): AgentProvider | undefined {
  const value = parseStringOrInherit(raw, label, reader);
  if (!value) return undefined;
  if ((agentProviderValues as readonly string[]).includes(value)) return value as AgentProvider;
  throw new Error(`Invalid config ${label}: ${value}. Expected one of: inherit, ${agentProviderValues.join(", ")}`);
}

function parseReasoningEffort(raw: unknown, label: string, reader: ConfigReader): CodexReasoningEffort | undefined {
  const value = parseStringOrInherit(raw, label, reader);
  if (!value) return undefined;
  if ((codexReasoningEffortValues as readonly string[]).includes(value)) return value as CodexReasoningEffort;
  throw new Error(`Invalid config ${label}: ${value}. Expected one of: inherit, ${codexReasoningEffortValues.join(", ")}`);
}

function parseOptionalPositiveInt(raw: unknown, label: string, reader: ConfigReader): number | undefined {
  const value = parseStringOrInherit(raw, label, reader);
  if (!value) return undefined;
  const numberValue = typeof raw === "number" ? raw : Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new Error(`Invalid config ${label}: expected positive integer`);
  }
  return numberValue;
}

function parseOptionalPositiveNumber(raw: unknown, label: string, reader: ConfigReader): number | undefined {
  const value = parseStringOrInherit(raw, label, reader);
  if (!value) return undefined;
  const numberValue = typeof raw === "number" ? raw : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`Invalid config ${label}: expected positive number`);
  }
  return numberValue;
}

function parseModelOverrideObject(
  value: unknown,
  label: string,
  reader: ConfigReader,
): AgentRunManagerRoleModelOverride {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw new Error(`Invalid config ${label}: expected object`);
  const provider = parseProvider(value.provider, `${label}.provider`, reader);
  const model = parseStringOrInherit(value.model, `${label}.model`, reader);
  const reasoningEffort = parseReasoningEffort(value.reasoning_effort ?? value.reasoningEffort, `${label}.reasoning_effort`, reader);
  const maxTurns = parseOptionalPositiveInt(value.max_turns ?? value.maxTurns, `${label}.max_turns`, reader);
  const budgetUsd = parseOptionalPositiveNumber(value.budget_usd ?? value.budgetUsd, `${label}.budget_usd`, reader);
  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(budgetUsd !== undefined ? { budgetUsd } : {}),
  };
}

function mergeModelOverrides(
  base: AgentRunManagerRoleModelOverride | undefined,
  next: AgentRunManagerRoleModelOverride | undefined,
): AgentRunManagerRoleModelOverride {
  return {
    ...(base ?? {}),
    ...(next ?? {}),
  };
}

function parseModelOverrideFromReader(
  reader: ConfigReader,
  path: ConfigPath,
  envPrefix: string,
): AgentRunManagerRoleModelOverride {
  const provider = parseProvider(reader.readRaw([...path, "provider"], `${envPrefix}_PROVIDER`), `${envPrefix}_PROVIDER / ${path.join(".")}.provider`, reader);
  const model = parseStringOrInherit(reader.readRaw([...path, "model"], `${envPrefix}_MODEL`), `${envPrefix}_MODEL / ${path.join(".")}.model`, reader);
  const reasoningEffort = parseReasoningEffort(
    reader.readRaw([[...path, "reasoning_effort"], [...path, "reasoningEffort"]], `${envPrefix}_REASONING_EFFORT`),
    `${envPrefix}_REASONING_EFFORT / ${path.join(".")}.reasoning_effort`,
    reader,
  );
  const maxTurns = parseOptionalPositiveInt(
    reader.readRaw([[...path, "max_turns"], [...path, "maxTurns"]], `${envPrefix}_MAX_TURNS`),
    `${envPrefix}_MAX_TURNS / ${path.join(".")}.max_turns`,
    reader,
  );
  const budgetUsd = parseOptionalPositiveNumber(
    reader.readRaw([[...path, "budget_usd"], [...path, "budgetUsd"]], `${envPrefix}_BUDGET_USD`),
    `${envPrefix}_BUDGET_USD / ${path.join(".")}.budget_usd`,
    reader,
  );
  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(budgetUsd !== undefined ? { budgetUsd } : {}),
  };
}

function buildModelRoutingRuntimeConfig(reader: ConfigReader): AgentRunManagerModelRoutingConfig {
  const basePath = ["agent_run_manager", "model_routing"] as const;
  const roles: Record<string, AgentRunManagerRoleModelOverride> = {};
  const rawRoles = reader.getPath([...basePath, "roles"]);
  if (rawRoles !== undefined) {
    if (!isPlainObject(rawRoles)) throw new Error("Invalid config agent_run_manager.model_routing.roles: expected object");
    for (const [role, value] of Object.entries(rawRoles)) {
      roles[role] = parseModelOverrideObject(value, `agent_run_manager.model_routing.roles.${role}`, reader);
    }
  }

  for (const role of MODEL_ROUTING_KNOWN_ROLES) {
    const override = parseModelOverrideFromReader(
      reader,
      [...basePath, "roles", role],
      envPrefixForRole(role),
    );
    roles[role] = mergeModelOverrides(roles[role], override);
  }

  return {
    enabled: reader.boolValue(
      [...basePath, "enabled"],
      "MINICLAW_AGENT_RUN_MANAGER_MODEL_ROUTING_ENABLED",
      false
    ),
    defaults: parseModelOverrideFromReader(
      reader,
      [...basePath, "defaults"],
      "MINICLAW_AGENT_RUN_MANAGER_MODEL_ROUTING_DEFAULT",
    ),
    roles,
    escalation: {
      enabled: reader.boolValue(
        [...basePath, "escalation", "enabled"],
        "MINICLAW_AGENT_RUN_MANAGER_ESCALATION_ENABLED",
        false
      ),
      roles: reader.stringArray(
        [...basePath, "escalation", "roles"],
        "MINICLAW_AGENT_RUN_MANAGER_ESCALATION_ROLES",
        ["generator"]
      ),
      override: parseModelOverrideFromReader(
        reader,
        [...basePath, "escalation"],
        "MINICLAW_AGENT_RUN_MANAGER_ESCALATION",
      ),
      maxAttempts: reader.positiveInt(
        [[...basePath, "escalation", "max_attempts"], [...basePath, "escalation", "maxAttempts"]],
        "MINICLAW_AGENT_RUN_MANAGER_ESCALATION_MAX_ATTEMPTS",
        1
      ),
    },
  };
}

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
    modelRouting: buildModelRoutingRuntimeConfig(reader),
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
