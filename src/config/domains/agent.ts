import type { ConfigReader } from "../env.js";
import { resolveHome } from "../resolve.js";
import {
  agentProviderValues,
  codexApprovalPolicyValues,
  codexReasoningEffortValues,
  codexSandboxModeValues,
  codexWebSearchModeValues,
} from "../schema.js";
import type {
  AgentProvider,
  CodexApprovalPolicy,
  CodexReasoningEffort,
  CodexSandboxMode,
  CodexWebSearchMode,
} from "../types.js";

export function buildAgentRuntimeConfig(reader: ConfigReader) {
  const agentProvider = reader.oneOf<AgentProvider>(
    ["agent", "provider"],
    "MINICLAW_AGENT_PROVIDER",
    "claude",
    agentProviderValues
  );
  const claudeModel = reader.requiredString(
    ["claude", "model"],
    ["MINICLAW_CLAUDE_MODEL", "MINICLAW_MODEL"],
    "claude-opus-4-7"
  );
  const codexModel = reader.stringOrInherit(["codex", "model"], "MINICLAW_CODEX_MODEL", "gpt-5.5");
  const codexPath = reader.optionalString(["codex", "path"], "MINICLAW_CODEX_PATH");
  const defaultAgentRuntime = reader.oneOf<AgentProvider>(
    [["runtime", "default_agent"], ["runtime", "defaultAgent"]],
    "MINICLAW_RUNTIME_DEFAULT_AGENT",
    agentProvider,
    agentProviderValues
  );
  const defaultCwd = resolveHome(reader.requiredString(["agent", "default_cwd"], "MINICLAW_DEFAULT_CWD", "~/Code"));

  return {
    agentProvider,
    runtime: {
      defaultAgent: defaultAgentRuntime,
    },
    defaultCwd,
    maxConcurrentTasks: reader.positiveInt(["agent", "max_concurrent_tasks"], "MINICLAW_MAX_CONCURRENT_TASKS", 3),
    defaultBudgetUsd: reader.numberOrUnlimited(["agent", "budget_usd"], "MINICLAW_DEFAULT_BUDGET_USD", 1.0),
    defaultMaxTurns: reader.numberOrUnlimited(["agent", "max_turns"], "MINICLAW_DEFAULT_MAX_TURNS", 30),
    chatTimeoutMs: reader.positiveNumber(["agent", "chat_timeout_ms"], "MINICLAW_CHAT_TIMEOUT_MS", 180000),
    attachmentTimeoutMs: reader.positiveNumber(
      ["agent", "attachment_timeout_ms"],
      "MINICLAW_ATTACHMENT_TIMEOUT_MS",
      30000
    ),
    shutdownDrainTimeoutMs: reader.positiveNumber(
      ["agent", "shutdown_drain_timeout_ms"],
      "MINICLAW_SHUTDOWN_DRAIN_TIMEOUT_MS",
      1_800_000
    ),
    registerCommandsOnStart: reader.boolValue(
      ["agent", "register_commands_on_start"],
      "MINICLAW_REGISTER_COMMANDS_ON_START",
      false
    ),
    // Backward-compatible alias used by older code paths. New provider-aware code
    // should prefer claudeModel / codex.model.
    model: defaultAgentRuntime === "claude" ? claudeModel : (codexModel ?? "inherit"),
    claudeModel,
    claude: {
      settingSources: reader.settingSources(["claude", "setting_sources"], "MINICLAW_CLAUDE_SETTING_SOURCES", [
        "user",
        "project",
        "local",
      ]),
      disableHooks: reader.boolValue(["claude", "disable_hooks"], "MINICLAW_CLAUDE_DISABLE_HOOKS", true),
    },
    codex: {
      path: codexPath ? resolveHome(codexPath) : undefined,
      model: codexModel,
      reasoningEffort: reader.oneOfOrInherit<CodexReasoningEffort>(
        ["codex", "reasoning_effort"],
        "MINICLAW_CODEX_REASONING_EFFORT",
        "medium",
        codexReasoningEffortValues
      ),
      taskSandbox: reader.oneOfOrInherit<CodexSandboxMode>(
        ["codex", "sandbox", "task"],
        "MINICLAW_CODEX_TASK_SANDBOX",
        "workspace-write",
        codexSandboxModeValues
      ),
      chatSandbox: reader.oneOfOrInherit<CodexSandboxMode>(
        ["codex", "sandbox", "chat"],
        "MINICLAW_CODEX_CHAT_SANDBOX",
        "read-only",
        codexSandboxModeValues
      ),
      approvalPolicy: reader.oneOfOrInherit<CodexApprovalPolicy>(
        ["codex", "approval_policy"],
        "MINICLAW_CODEX_APPROVAL_POLICY",
        "never",
        codexApprovalPolicyValues
      ),
      webSearchMode: reader.oneOfOrInherit<CodexWebSearchMode>(
        ["codex", "web_search"],
        "MINICLAW_CODEX_WEB_SEARCH",
        "live",
        codexWebSearchModeValues
      ),
      timeoutMs: reader.positiveNumber(["codex", "timeout_ms"], "MINICLAW_CODEX_TIMEOUT_MS", 1800000),
      networkAccess: reader.boolOrInherit(["codex", "network_access"], "MINICLAW_CODEX_NETWORK_ACCESS", true),
    },
  } as const;
}
