import "../proxy.js";
import { tmpdir } from "node:os";
import { createLogger } from "../lib/log.js";
import { createConfigReader } from "./env.js";
import { assertE2eIsolation, assertE2eRuntimePath } from "./e2e-guard.js";
import { loadRuntimeConfigSource } from "./load.js";
import { channelDefaults, resolveHome } from "./resolve.js";
import {
  agentProviderValues,
  audioTranscriptionProviderValues,
  codexApprovalPolicyValues,
  codexReasoningEffortValues,
  codexSandboxModeValues,
  codexWebSearchModeValues,
  smartRouterClassifierProviderValues,
  smartRouterDefaultModeValues,
} from "./schema.js";
import type {
  AgentProvider,
  AudioTranscriptionProvider,
  CodexApprovalPolicy,
  CodexReasoningEffort,
  CodexSandboxMode,
  CodexWebSearchMode,
  SmartRouterClassifierProvider,
  SmartRouterDefaultMode,
  SmtpEmailNotificationConfig,
} from "./types.js";

export type {
  AgentProvider,
  AudioTranscriptionProvider,
  ClaudeSettingSource,
  CodexApprovalPolicy,
  CodexReasoningEffort,
  CodexSandboxMode,
  CodexWebSearchMode,
  SmartRouterClassifierProvider,
  SmartRouterDefaultMode,
  SmtpEmailNotificationConfig,
} from "./types.js";

const log = createLogger("config");

const configSource = loadRuntimeConfigSource();
const reader = createConfigReader(configSource.data);
const {
  requiredString,
  optionalString,
  stringOrInherit,
  oneOf,
  oneOfOrInherit,
  boolValue,
  boolOrInherit,
  stringArray,
  settingSources,
  positiveNumber,
  nonNegativeNumber,
  confidenceNumber,
  positiveInt,
  nonNegativeInt,
  numberOrUnlimited,
} = reader;

const agentProvider = oneOf<AgentProvider>(["agent", "provider"], "MINICLAW_AGENT_PROVIDER", "claude", agentProviderValues);
const claudeModel = requiredString(["claude", "model"], ["MINICLAW_CLAUDE_MODEL", "MINICLAW_MODEL"], "claude-opus-4-7");
const codexModel = stringOrInherit(["codex", "model"], "MINICLAW_CODEX_MODEL", "gpt-5.5");
const autoReplyChannelIds = stringArray(["routing", "auto_reply_channels"], "MINICLAW_AUTO_REPLY_CHANNELS", ["*"]);
const taskChannelIds = stringArray(["routing", "task_channels"], "MINICLAW_TASK_CHANNELS");
const channelDefaultConfig = channelDefaults(reader, ["routing", "channel_defaults"], []);
const anthropicBaseUrl = optionalString(["anthropic", "base_url"], "ANTHROPIC_BASE_URL");
const openaiBaseUrl = optionalString(["openai", "base_url"], "OPENAI_BASE_URL");
const smartRouterEnabled = boolValue(["routing", "smart_router", "enabled"], "MINICLAW_SMART_ROUTER_ENABLED", false);
const e2eMode = boolValue(["e2e", "mode"], "MINICLAW_E2E_MODE", false);
const e2eSenderUserIds = stringArray(["e2e", "sender_user_ids"], "MINICLAW_E2E_SENDER_USER_IDS");
const disableScheduler = boolValue(["e2e", "disable_scheduler"], "MINICLAW_DISABLE_SCHEDULER", false);
const e2eFakeAgent = boolValue(["e2e", "fake_agent"], "MINICLAW_E2E_FAKE_AGENT", false);
const defaultCwd = resolveHome(requiredString(["agent", "default_cwd"], "MINICLAW_DEFAULT_CWD", "~/Code"));
const shutdownDrainTimeoutMs = positiveNumber(
  ["agent", "shutdown_drain_timeout_ms"],
  "MINICLAW_SHUTDOWN_DRAIN_TIMEOUT_MS",
  1_800_000
);
const dbPath = resolveHome(requiredString(["storage", "db_path"], "MINICLAW_DB_PATH", "~/.miniclaw/data.db"));
const memoryPath = resolveHome(requiredString(["storage", "memory_path"], "MINICLAW_MEMORY_PATH", "~/.miniclaw/memories/MEMORY.md"));
const connectivityStatePath = resolveHome(requiredString(
  ["connectivity", "state_path"],
  "MINICLAW_CONNECTIVITY_STATE_PATH",
  "~/.miniclaw/runtime/connectivity.json"
));
const doctorAllowedPathsFallback = [
  "src/**/*.ts",
  "scripts/**/*.ts",
  "docs/**/*.md",
  "prompts/**/*.md",
  "config.example.yaml",
];
const doctorBlockedPathsFallback = [
  ".env",
  ".env.*",
  ".npmrc",
  ".netrc",
  "~/.miniclaw/**",
  "~/.ssh/**",
  "**/*.db",
  "**/*.sqlite",
  "**/*.log",
];
const doctorSummaryChannelId = optionalString(["doctor", "summary_channel_id"], "MINICLAW_DOCTOR_SUMMARY_CHANNEL_ID");
const doctorSummaryChannelName = optionalString(["doctor", "summary_channel_name"], "MINICLAW_DOCTOR_SUMMARY_CHANNEL_NAME")
  ?? "miniclaw-auto-improve";
const doctorRepairWorktreeRoot = resolveHome(requiredString(
  ["doctor", "repair_worktree_root"],
  "MINICLAW_DOCTOR_REPAIR_WORKTREE_ROOT",
  "~/ProjectRepo/miniclaw-repairs"
));
const doctorRepairCommitAuthorName = requiredString(
  ["doctor", "repair_commit_author_name"],
  "MINICLAW_DOCTOR_REPAIR_COMMIT_AUTHOR_NAME",
  "yuanyunfan"
);
const doctorRepairCommitAuthorEmail = requiredString(
  ["doctor", "repair_commit_author_email"],
  "MINICLAW_DOCTOR_REPAIR_COMMIT_AUTHOR_EMAIL",
  "59247355+yuanyunfan@users.noreply.github.com"
);
const notifyEmailHost = optionalString([
  ["notifications", "email", "smtp_host"],
  ["email", "smtp_host"],
], "MINICLAW_NOTIFY_EMAIL_SMTP_HOST");
const notifyEmailUsername = optionalString([
  ["notifications", "email", "username"],
  ["email", "username"],
], "MINICLAW_NOTIFY_EMAIL_USERNAME");
const notifyEmailPassword = optionalString([
  ["notifications", "email", "password"],
  ["email", "password"],
], "MINICLAW_NOTIFY_EMAIL_PASSWORD");
const notifyEmailTo = optionalString([
  ["notifications", "email", "to"],
  ["email", "to"],
], "MINICLAW_NOTIFY_EMAIL_TO");
const notifyEmailEnabledByConfig = Boolean(notifyEmailHost && notifyEmailUsername && notifyEmailPassword && notifyEmailTo);

if (anthropicBaseUrl && !process.env.ANTHROPIC_BASE_URL) process.env.ANTHROPIC_BASE_URL = anthropicBaseUrl;
if (openaiBaseUrl && !process.env.OPENAI_BASE_URL) process.env.OPENAI_BASE_URL = openaiBaseUrl;

if (!autoReplyChannelIds.length) {
  log.warn("auto_reply_channels 已禁用，普通频道消息需 @mention 触发");
}

assertE2eIsolation({
  e2eMode,
  configuredConfigPath: configSource.configuredPath,
  configPath: configSource.path,
  senderUserIds: e2eSenderUserIds,
  disableScheduler,
  fakeAgent: e2eFakeAgent,
  dbPath,
  memoryPath,
  defaultCwd,
  channelDefaults: channelDefaultConfig,
  tempRoot: tmpdir(),
});

export const config = {
  configFile: {
    path: configSource.path,
    loaded: configSource.loaded,
  },
  discord: {
    token: requiredString(["discord", "token"], "DISCORD_TOKEN"),
    clientId: requiredString(["discord", "client_id"], "DISCORD_CLIENT_ID"),
    guildId: requiredString(["discord", "guild_id"], "DISCORD_GUILD_ID"),
  },
  agentProvider,
  anthropicApiKey:
    agentProvider === "claude"
      ? requiredString(["anthropic", "api_key"], "ANTHROPIC_API_KEY")
      : optionalString(["anthropic", "api_key"], "ANTHROPIC_API_KEY"),
  anthropicBaseUrl,
  openaiApiKey: optionalString(["openai", "api_key"], "OPENAI_API_KEY"),
  openaiBaseUrl,
  allowedUserId: requiredString(["discord", "allowed_user_id"], "MINICLAW_ALLOWED_USER_ID"),
  defaultCwd,
  maxConcurrentTasks: positiveInt(["agent", "max_concurrent_tasks"], "MINICLAW_MAX_CONCURRENT_TASKS", 3),
  defaultBudgetUsd: numberOrUnlimited(["agent", "budget_usd"], "MINICLAW_DEFAULT_BUDGET_USD", 1.0),
  defaultMaxTurns: numberOrUnlimited(["agent", "max_turns"], "MINICLAW_DEFAULT_MAX_TURNS", 30),
  chatTimeoutMs: positiveNumber(["agent", "chat_timeout_ms"], "MINICLAW_CHAT_TIMEOUT_MS", 180000),
  attachmentTimeoutMs: positiveNumber(["agent", "attachment_timeout_ms"], "MINICLAW_ATTACHMENT_TIMEOUT_MS", 30000),
  shutdownDrainTimeoutMs,
  registerCommandsOnStart: boolValue(
    ["agent", "register_commands_on_start"],
    "MINICLAW_REGISTER_COMMANDS_ON_START",
    false
  ),
  // Backward-compatible alias used by older code paths. New provider-aware code
  // should prefer claudeModel / codex.model.
  model: agentProvider === "claude" ? claudeModel : (codexModel ?? "inherit"),
  claudeModel,
  claude: {
    settingSources: settingSources(["claude", "setting_sources"], "MINICLAW_CLAUDE_SETTING_SOURCES", [
      "user",
      "project",
      "local",
    ]),
    disableHooks: boolValue(["claude", "disable_hooks"], "MINICLAW_CLAUDE_DISABLE_HOOKS", true),
  },
  codex: {
    model: codexModel,
    reasoningEffort: oneOfOrInherit<CodexReasoningEffort>(
      ["codex", "reasoning_effort"],
      "MINICLAW_CODEX_REASONING_EFFORT",
      "medium",
      codexReasoningEffortValues
    ),
    taskSandbox: oneOfOrInherit<CodexSandboxMode>(
      ["codex", "sandbox", "task"],
      "MINICLAW_CODEX_TASK_SANDBOX",
      "workspace-write",
      codexSandboxModeValues
    ),
    chatSandbox: oneOfOrInherit<CodexSandboxMode>(
      ["codex", "sandbox", "chat"],
      "MINICLAW_CODEX_CHAT_SANDBOX",
      "read-only",
      codexSandboxModeValues
    ),
    approvalPolicy: oneOfOrInherit<CodexApprovalPolicy>(
      ["codex", "approval_policy"],
      "MINICLAW_CODEX_APPROVAL_POLICY",
      "never",
      codexApprovalPolicyValues
    ),
    webSearchMode: oneOfOrInherit<CodexWebSearchMode>(
      ["codex", "web_search"],
      "MINICLAW_CODEX_WEB_SEARCH",
      "live",
      codexWebSearchModeValues
    ),
    timeoutMs: positiveNumber(["codex", "timeout_ms"], "MINICLAW_CODEX_TIMEOUT_MS", 1800000),
    networkAccess: boolOrInherit(["codex", "network_access"], "MINICLAW_CODEX_NETWORK_ACCESS", true),
  },
  mcp: {
    configPath: resolveHome(requiredString(["mcp", "config"], "MINICLAW_MCP_CONFIG", "~/.claude.json")),
    allowlist: stringArray(["mcp", "allowlist"], "MINICLAW_MCP_ALLOWLIST", ["exa", "context7"]),
  },
  autoReplyChannelIds,
  taskChannelIds,
  channelDefaults: channelDefaultConfig,
  tasks: {
    traceAutoAttach: {
      enabled: boolValue(
        ["tasks", "trace_auto_attach", "enabled"],
        "MINICLAW_TASK_TRACE_AUTO_ATTACH_ENABLED",
        false
      ),
      onFailure: boolValue(
        ["tasks", "trace_auto_attach", "on_failure"],
        "MINICLAW_TASK_TRACE_AUTO_ATTACH_ON_FAILURE",
        true
      ),
      minDurationMs: nonNegativeNumber(
        ["tasks", "trace_auto_attach", "min_duration_ms"],
        "MINICLAW_TASK_TRACE_AUTO_ATTACH_MIN_DURATION_MS",
        0
      ),
      minEventCount: nonNegativeInt(
        ["tasks", "trace_auto_attach", "min_event_count"],
        "MINICLAW_TASK_TRACE_AUTO_ATTACH_MIN_EVENT_COUNT",
        0
      ),
      maxBytes: positiveInt(
        ["tasks", "trace_auto_attach", "max_bytes"],
        "MINICLAW_TASK_TRACE_AUTO_ATTACH_MAX_BYTES",
        120_000
      ),
    },
  },
  smartRouter: {
    enabled: smartRouterEnabled,
    defaultMode: oneOf<SmartRouterDefaultMode>(
      ["routing", "smart_router", "default_mode"],
      "MINICLAW_SMART_ROUTER_DEFAULT_MODE",
      "confirm",
      smartRouterDefaultModeValues
    ),
    minConfirmConfidence: confidenceNumber(
      ["routing", "smart_router", "min_confirm_confidence"],
      "MINICLAW_SMART_ROUTER_MIN_CONFIRM_CONFIDENCE",
      0.55
    ),
    minAutoConfidence: confidenceNumber(
      ["routing", "smart_router", "min_auto_confidence"],
      "MINICLAW_SMART_ROUTER_MIN_AUTO_CONFIDENCE",
      0.9
    ),
    confirmChannelIds: stringArray(
      ["routing", "smart_router", "confirm_channels"],
      "MINICLAW_SMART_ROUTER_CONFIRM_CHANNELS"
    ),
    autoTaskChannelIds: stringArray(
      ["routing", "smart_router", "auto_task_channels"],
      "MINICLAW_SMART_ROUTER_AUTO_TASK_CHANNELS"
    ),
    llmClassifier: {
      enabled: boolValue(
        ["routing", "smart_router", "llm_classifier", "enabled"],
        "MINICLAW_SMART_ROUTER_LLM_ENABLED",
        true
      ),
      onlyWhenAmbiguous: boolValue(
        ["routing", "smart_router", "llm_classifier", "only_when_ambiguous"],
        "MINICLAW_SMART_ROUTER_LLM_ONLY_WHEN_AMBIGUOUS",
        true
      ),
      provider: oneOf<SmartRouterClassifierProvider>(
        ["routing", "smart_router", "llm_classifier", "provider"],
        "MINICLAW_SMART_ROUTER_LLM_PROVIDER",
        "auto",
        smartRouterClassifierProviderValues
      ),
      model: stringOrInherit(
        ["routing", "smart_router", "llm_classifier", "model"],
        "MINICLAW_SMART_ROUTER_LLM_MODEL",
        "inherit"
      ),
      timeoutMs: positiveNumber(
        ["routing", "smart_router", "llm_classifier", "timeout_ms"],
        "MINICLAW_SMART_ROUTER_LLM_TIMEOUT_MS",
        8_000
      ),
      fallbackToCodex: boolValue(
        ["routing", "smart_router", "llm_classifier", "fallback_to_codex"],
        "MINICLAW_SMART_ROUTER_LLM_FALLBACK_TO_CODEX",
        false
      ),
    },
    confirmation: {
      state: oneOf<"memory">(
        ["routing", "smart_router", "confirmation", "state"],
        "MINICLAW_SMART_ROUTER_CONFIRMATION_STATE",
        "memory",
        ["memory"]
      ),
      timeoutSeconds: positiveInt(
        ["routing", "smart_router", "confirmation", "timeout_seconds"],
        "MINICLAW_SMART_ROUTER_CONFIRMATION_TIMEOUT_SECONDS",
        600
      ),
    },
    context: {
      includeRecentWhenReferenced: boolValue(
        ["routing", "smart_router", "context", "include_recent_when_referenced"],
        "MINICLAW_SMART_ROUTER_CONTEXT_INCLUDE_RECENT_WHEN_REFERENCED",
        true
      ),
      recentTurns: positiveInt(
        ["routing", "smart_router", "context", "recent_turns"],
        "MINICLAW_SMART_ROUTER_CONTEXT_RECENT_TURNS",
        6
      ),
      maxChars: positiveInt(
        ["routing", "smart_router", "context", "max_chars"],
        "MINICLAW_SMART_ROUTER_CONTEXT_MAX_CHARS",
        8000
      ),
    },
    decisionLog: {
      enabled: boolValue(
        ["routing", "smart_router", "decision_log", "enabled"],
        "MINICLAW_SMART_ROUTER_DECISION_LOG_ENABLED",
        true
      ),
      store: oneOf<"sqlite">(
        ["routing", "smart_router", "decision_log", "store"],
        "MINICLAW_SMART_ROUTER_DECISION_LOG_STORE",
        "sqlite",
        ["sqlite"]
      ),
      promptPreviewChars: positiveInt(
        ["routing", "smart_router", "decision_log", "prompt_preview_chars"],
        "MINICLAW_SMART_ROUTER_DECISION_LOG_PROMPT_PREVIEW_CHARS",
        160
      ),
      storeFullPrompt: boolValue(
        ["routing", "smart_router", "decision_log", "store_full_prompt"],
        "MINICLAW_SMART_ROUTER_DECISION_LOG_STORE_FULL_PROMPT",
        false
      ),
    },
  },
  dbPath,
  memoryPath,
  state: {
    retention: {
      chatHistoryDays: positiveInt(
        ["state", "retention", "chat_history_days"],
        "MINICLAW_STATE_RETENTION_CHAT_HISTORY_DAYS",
        90
      ),
      taskEventsDays: positiveInt(
        ["state", "retention", "task_events_days"],
        "MINICLAW_STATE_RETENTION_TASK_EVENTS_DAYS",
        90
      ),
      smartRouterDecisionsDays: positiveInt(
        ["state", "retention", "smart_router_decisions_days"],
        "MINICLAW_STATE_RETENTION_SMART_ROUTER_DECISIONS_DAYS",
        180
      ),
      incidentsDays: positiveInt(
        ["state", "retention", "incidents_days"],
        "MINICLAW_STATE_RETENTION_INCIDENTS_DAYS",
        365
      ),
      repairRunsDays: positiveInt(
        ["state", "retention", "repair_runs_days"],
        "MINICLAW_STATE_RETENTION_REPAIR_RUNS_DAYS",
        365
      ),
      marketForecastsDays: positiveInt(
        ["state", "retention", "market_forecasts_days"],
        "MINICLAW_STATE_RETENTION_MARKET_FORECASTS_DAYS",
        730
      ),
      dryRunDefault: boolValue(
        ["state", "retention", "dry_run_default"],
        "MINICLAW_STATE_RETENTION_DRY_RUN_DEFAULT",
        true
      ),
    },
  },
  e2e: {
    mode: e2eMode,
    senderUserIds: e2eSenderUserIds,
    disableScheduler,
    fakeAgent: e2eFakeAgent,
    tempRoot: tmpdir(),
  },
  connectivity: {
    enabled: boolValue(["connectivity", "enabled"], "MINICLAW_CONNECTIVITY_MONITOR_ENABLED", !e2eMode),
    intervalMs: positiveNumber(["connectivity", "interval_ms"], "MINICLAW_CONNECTIVITY_INTERVAL_MS", 60_000),
    failureThreshold: positiveInt(["connectivity", "failure_threshold"], "MINICLAW_CONNECTIVITY_FAILURE_THRESHOLD", 3),
    requestTimeoutMs: positiveNumber(["connectivity", "request_timeout_ms"], "MINICLAW_CONNECTIVITY_REQUEST_TIMEOUT_MS", 10_000),
    generalTestUrl: requiredString(["connectivity", "general_test_url"], "MINICLAW_CONNECTIVITY_GENERAL_TEST_URL", "https://www.qq.com"),
    statePath: connectivityStatePath,
  },
  doctor: {
    enabled: boolValue(["doctor", "enabled"], "MINICLAW_DOCTOR_ENABLED", true),
    autoDiagnoseEnabled: boolValue(
      ["doctor", "auto_diagnose_enabled"],
      "MINICLAW_DOCTOR_AUTO_DIAGNOSE_ENABLED",
      false
    ),
    scanIntervalMs: positiveNumber(
      ["doctor", "scan_interval_ms"],
      "MINICLAW_DOCTOR_SCAN_INTERVAL_MS",
      7_200_000
    ),
    summaryChannelId: doctorSummaryChannelId,
    summaryChannelName: doctorSummaryChannelName,
    autoRepairEnabled: boolValue(["doctor", "auto_repair_enabled"], "MINICLAW_DOCTOR_AUTO_REPAIR_ENABLED", false),
    autoCommitEnabled: boolValue(["doctor", "auto_commit_enabled"], "MINICLAW_DOCTOR_AUTO_COMMIT_ENABLED", true),
    autoPushEnabled: boolValue(["doctor", "auto_push_enabled"], "MINICLAW_DOCTOR_AUTO_PUSH_ENABLED", false),
    autoRestartEnabled: boolValue(["doctor", "auto_restart_enabled"], "MINICLAW_DOCTOR_AUTO_RESTART_ENABLED", false),
    maxRepairsPerDay: positiveInt(["doctor", "max_repairs_per_day"], "MINICLAW_DOCTOR_MAX_REPAIRS_PER_DAY", 2),
    maxParallelRepairs: positiveInt(["doctor", "max_parallel_repairs"], "MINICLAW_DOCTOR_MAX_PARALLEL_REPAIRS", 1),
    maxPatchFiles: positiveInt(["doctor", "max_patch_files"], "MINICLAW_DOCTOR_MAX_PATCH_FILES", 8),
    repairWorktreeRoot: doctorRepairWorktreeRoot,
    repairCommitAuthorName: doctorRepairCommitAuthorName,
    repairCommitAuthorEmail: doctorRepairCommitAuthorEmail,
    requireApprovalForMain: boolValue(["doctor", "require_approval_for_main"], "MINICLAW_DOCTOR_REQUIRE_APPROVAL_FOR_MAIN", true),
    allowedPaths: stringArray(["doctor", "allowed_paths"], "MINICLAW_DOCTOR_ALLOWED_PATHS", doctorAllowedPathsFallback),
    blockedPaths: stringArray(["doctor", "blocked_paths"], "MINICLAW_DOCTOR_BLOCKED_PATHS", doctorBlockedPathsFallback),
  },
  notifications: {
    email: {
      enabled: boolValue([
        ["notifications", "email", "enabled"],
        ["email", "enabled"],
      ], "MINICLAW_NOTIFY_EMAIL_ENABLED", notifyEmailEnabledByConfig),
      smtpHost: notifyEmailHost,
      smtpPort: positiveInt([
        ["notifications", "email", "smtp_port"],
        ["email", "smtp_port"],
      ], "MINICLAW_NOTIFY_EMAIL_SMTP_PORT", 465),
      useSsl: boolValue([
        ["notifications", "email", "use_ssl"],
        ["email", "use_ssl"],
      ], "MINICLAW_NOTIFY_EMAIL_USE_SSL", true),
      username: notifyEmailUsername,
      password: notifyEmailPassword,
      from: optionalString([
        ["notifications", "email", "from"],
        ["email", "from"],
      ], "MINICLAW_NOTIFY_EMAIL_FROM"),
      to: notifyEmailTo,
    } satisfies SmtpEmailNotificationConfig,
  },
  maxAttachmentMb: positiveNumber(["attachments", "max_mb"], "MINICLAW_MAX_ATTACHMENT_MB", 32),
  maxAttachments: positiveInt(["attachments", "max_count"], "MINICLAW_MAX_ATTACHMENTS", 10),
  audioTranscription: {
    enabled: boolValue(
      ["attachments", "audio_transcription", "enabled"],
      "MINICLAW_AUDIO_TRANSCRIPTION_ENABLED",
      true
    ),
    provider: oneOf<AudioTranscriptionProvider>(
      ["attachments", "audio_transcription", "provider"],
      "MINICLAW_AUDIO_TRANSCRIPTION_PROVIDER",
      "auto",
      audioTranscriptionProviderValues
    ),
    model: requiredString(
      ["attachments", "audio_transcription", "model"],
      "MINICLAW_AUDIO_TRANSCRIPTION_MODEL",
      "gpt-4o-mini-transcribe"
    ),
    localModel: requiredString(
      ["attachments", "audio_transcription", "local_model"],
      "MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_MODEL",
      "base"
    ),
    localPython: requiredString(
      ["attachments", "audio_transcription", "local_python"],
      "MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_PYTHON",
      "python3"
    ),
    localDevice: requiredString(
      ["attachments", "audio_transcription", "local_device"],
      "MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_DEVICE",
      "cpu"
    ),
    localComputeType: requiredString(
      ["attachments", "audio_transcription", "local_compute_type"],
      "MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_COMPUTE_TYPE",
      "int8"
    ),
    maxMb: positiveNumber(
      ["attachments", "audio_transcription", "max_mb"],
      "MINICLAW_AUDIO_TRANSCRIPTION_MAX_MB",
      25
    ),
    timeoutMs: positiveNumber(
      ["attachments", "audio_transcription", "timeout_ms"],
      "MINICLAW_AUDIO_TRANSCRIPTION_TIMEOUT_MS",
      120_000
    ),
    language: optionalString(
      ["attachments", "audio_transcription", "language"],
      "MINICLAW_AUDIO_TRANSCRIPTION_LANGUAGE"
    ),
  },
} as const;

export function assertE2eSafeRuntimePath(kind: string, path: string): void {
  assertE2eRuntimePath(kind, path, config.e2e.mode, config.e2e.tempRoot);
}
