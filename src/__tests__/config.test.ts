import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ENV_KEYS = [
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_GUILD_ID",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "MINICLAW_CONFIG",
  "MINICLAW_AGENT_PROVIDER",
  "MINICLAW_RUNTIME_DEFAULT_AGENT",
  "MINICLAW_AGENT_RUN_MANAGER_ENABLED",
  "MINICLAW_AGENT_RUN_MANAGER_MAX_TURNS",
  "MINICLAW_AGENT_RUN_MANAGER_TIMEOUT_MS",
  "MINICLAW_AGENT_RUN_MANAGER_CHILD_TIMEOUT_MS",
  "MINICLAW_AGENT_RUN_MANAGER_MAX_MESSAGES",
  "MINICLAW_AGENT_RUN_MANAGER_MAX_ARTIFACT_BYTES",
  "MINICLAW_AGENT_RUN_MANAGER_MAX_SPAWN_DEPTH",
  "MINICLAW_AGENT_RUN_MANAGER_MAX_CHILDREN_PER_RUN",
  "MINICLAW_AGENT_RUN_MANAGER_MAX_CONCURRENT_RUNS",
  "MINICLAW_AGENT_RUN_MANAGER_MAX_PING_PONG_TURNS",
  "MINICLAW_AGENT_RUN_MANAGER_CLEANUP_TTL_MS",
  "MINICLAW_AGENT_RUN_MANAGER_MAX_FIX_ITERATIONS",
  "MINICLAW_MODEL_DEFAULT_CLIENT",
  "MINICLAW_IM_DEFAULT_TRANSPORT",
  "MINICLAW_IM_DISCORD_ENABLED",
  "MINICLAW_IM_FEISHU_ENABLED",
  "MINICLAW_FEISHU_WEBHOOK_URL",
  "MINICLAW_FEISHU_SECRET",
  "MINICLAW_ALLOWED_USER_ID",
  "MINICLAW_DEFAULT_CWD",
  "MINICLAW_MAX_CONCURRENT_TASKS",
  "MINICLAW_DEFAULT_BUDGET_USD",
  "MINICLAW_DEFAULT_MAX_TURNS",
  "MINICLAW_CHAT_TIMEOUT_MS",
  "MINICLAW_ATTACHMENT_TIMEOUT_MS",
  "MINICLAW_SHUTDOWN_DRAIN_TIMEOUT_MS",
  "MINICLAW_REGISTER_COMMANDS_ON_START",
  "MINICLAW_CLAUDE_MODEL",
  "MINICLAW_MODEL",
  "MINICLAW_CLAUDE_SETTING_SOURCES",
  "MINICLAW_CLAUDE_DISABLE_HOOKS",
  "MINICLAW_CODEX_MODEL",
  "MINICLAW_CODEX_REASONING_EFFORT",
  "MINICLAW_CODEX_TASK_SANDBOX",
  "MINICLAW_CODEX_CHAT_SANDBOX",
  "MINICLAW_CODEX_APPROVAL_POLICY",
  "MINICLAW_CODEX_WEB_SEARCH",
  "MINICLAW_CODEX_TIMEOUT_MS",
  "MINICLAW_CODEX_NETWORK_ACCESS",
  "MINICLAW_AUTO_REPLY_CHANNELS",
  "MINICLAW_TASK_CHANNELS",
  "MINICLAW_TASK_TRACE_AUTO_ATTACH_ENABLED",
  "MINICLAW_TASK_TRACE_AUTO_ATTACH_ON_FAILURE",
  "MINICLAW_TASK_TRACE_AUTO_ATTACH_MIN_DURATION_MS",
  "MINICLAW_TASK_TRACE_AUTO_ATTACH_MIN_EVENT_COUNT",
  "MINICLAW_TASK_TRACE_AUTO_ATTACH_MAX_BYTES",
  "MINICLAW_CRON_ACTIVE_WINDOW_ENABLED",
  "MINICLAW_CRON_ACTIVE_WINDOW_TIMEZONE",
  "MINICLAW_CRON_ACTIVE_WINDOW_START",
  "MINICLAW_CRON_ACTIVE_WINDOW_END",
  "MINICLAW_SMART_ROUTER_ENABLED",
  "MINICLAW_SMART_ROUTER_DEFAULT_MODE",
  "MINICLAW_SMART_ROUTER_MIN_CONFIRM_CONFIDENCE",
  "MINICLAW_SMART_ROUTER_MIN_AUTO_CONFIDENCE",
  "MINICLAW_SMART_ROUTER_CONFIRM_CHANNELS",
  "MINICLAW_SMART_ROUTER_AUTO_TASK_CHANNELS",
  "MINICLAW_SMART_ROUTER_LLM_ENABLED",
  "MINICLAW_SMART_ROUTER_LLM_ONLY_WHEN_AMBIGUOUS",
  "MINICLAW_SMART_ROUTER_LLM_PROVIDER",
  "MINICLAW_SMART_ROUTER_LLM_MODEL",
  "MINICLAW_SMART_ROUTER_LLM_TIMEOUT_MS",
  "MINICLAW_SMART_ROUTER_LLM_FALLBACK_TO_CODEX",
  "MINICLAW_SMART_ROUTER_CONFIRMATION_STATE",
  "MINICLAW_SMART_ROUTER_CONFIRMATION_TIMEOUT_SECONDS",
  "MINICLAW_SMART_ROUTER_CONTEXT_INCLUDE_RECENT_WHEN_REFERENCED",
  "MINICLAW_SMART_ROUTER_CONTEXT_RECENT_TURNS",
  "MINICLAW_SMART_ROUTER_CONTEXT_MAX_CHARS",
  "MINICLAW_SMART_ROUTER_DECISION_LOG_ENABLED",
  "MINICLAW_SMART_ROUTER_DECISION_LOG_STORE",
  "MINICLAW_SMART_ROUTER_DECISION_LOG_PROMPT_PREVIEW_CHARS",
  "MINICLAW_SMART_ROUTER_DECISION_LOG_STORE_FULL_PROMPT",
  "MINICLAW_MCP_CONFIG",
  "MINICLAW_MCP_ALLOWLIST",
  "MINICLAW_DB_PATH",
  "MINICLAW_MEMORY_PATH",
  "MINICLAW_STATE_RETENTION_CHAT_HISTORY_DAYS",
  "MINICLAW_STATE_RETENTION_TASK_EVENTS_DAYS",
  "MINICLAW_STATE_RETENTION_SMART_ROUTER_DECISIONS_DAYS",
  "MINICLAW_STATE_RETENTION_INCIDENTS_DAYS",
  "MINICLAW_STATE_RETENTION_REPAIR_RUNS_DAYS",
  "MINICLAW_STATE_RETENTION_MARKET_FORECASTS_DAYS",
  "MINICLAW_STATE_RETENTION_DRY_RUN_DEFAULT",
  "MINICLAW_E2E_MODE",
  "MINICLAW_E2E_SENDER_USER_IDS",
  "MINICLAW_DISABLE_SCHEDULER",
  "MINICLAW_E2E_FAKE_AGENT",
  "MINICLAW_MAX_ATTACHMENT_MB",
  "MINICLAW_MAX_ATTACHMENTS",
  "MINICLAW_AUDIO_TRANSCRIPTION_ENABLED",
  "MINICLAW_AUDIO_TRANSCRIPTION_PROVIDER",
  "MINICLAW_AUDIO_TRANSCRIPTION_MODEL",
  "MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_MODEL",
  "MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_PYTHON",
  "MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_DEVICE",
  "MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_COMPUTE_TYPE",
  "MINICLAW_AUDIO_TRANSCRIPTION_MAX_MB",
  "MINICLAW_AUDIO_TRANSCRIPTION_TIMEOUT_MS",
  "MINICLAW_AUDIO_TRANSCRIPTION_LANGUAGE",
  "MINICLAW_CONNECTIVITY_MONITOR_ENABLED",
  "MINICLAW_CONNECTIVITY_INTERVAL_MS",
  "MINICLAW_CONNECTIVITY_FAILURE_THRESHOLD",
  "MINICLAW_CONNECTIVITY_REQUEST_TIMEOUT_MS",
  "MINICLAW_CONNECTIVITY_GENERAL_TEST_URL",
  "MINICLAW_CONNECTIVITY_STATE_PATH",
  "MINICLAW_STARTUP_WATCHDOG_ENABLED",
  "MINICLAW_STARTUP_WATCHDOG_CLIENT_READY_TIMEOUT_MS",
  "MINICLAW_STARTUP_WATCHDOG_MACOS_NOTIFICATION_ENABLED",
  "MINICLAW_DOCTOR_ENABLED",
  "MINICLAW_DOCTOR_AUTO_DIAGNOSE_ENABLED",
  "MINICLAW_DOCTOR_SCAN_INTERVAL_MS",
  "MINICLAW_DOCTOR_SUMMARY_CHANNEL_ID",
  "MINICLAW_DOCTOR_SUMMARY_CHANNEL_NAME",
  "MINICLAW_DOCTOR_AUTO_REPAIR_ENABLED",
  "MINICLAW_DOCTOR_AUTO_COMMIT_ENABLED",
  "MINICLAW_DOCTOR_AUTO_PUSH_ENABLED",
  "MINICLAW_DOCTOR_AUTO_RESTART_ENABLED",
  "MINICLAW_DOCTOR_MAX_REPAIRS_PER_DAY",
  "MINICLAW_DOCTOR_MAX_PARALLEL_REPAIRS",
  "MINICLAW_DOCTOR_MAX_PATCH_FILES",
  "MINICLAW_DOCTOR_REPAIR_WORKTREE_ROOT",
  "MINICLAW_DOCTOR_REPAIR_COMMIT_AUTHOR_NAME",
  "MINICLAW_DOCTOR_REPAIR_COMMIT_AUTHOR_EMAIL",
  "MINICLAW_DOCTOR_REQUIRE_APPROVAL_FOR_MAIN",
  "MINICLAW_DOCTOR_ALLOWED_PATHS",
  "MINICLAW_DOCTOR_BLOCKED_PATHS",
  "MINICLAW_HOOKD_ENABLED",
  "MINICLAW_HOOKD_SOCKET",
  "MINICLAW_HOOKD_MAX_PAYLOAD_BYTES",
  "MINICLAW_HOOKD_ZOMBIE_SCAN_INTERVAL_MS",
  "MINICLAW_HOOKD_APPROVAL_TIMEOUT_MS",
  "MINICLAW_HOOKD_STALE_ACTIVE_MS",
  "MINICLAW_HOOKD_DASHBOARD_LIMIT",
  "MINICLAW_NOTIFY_EMAIL_ENABLED",
  "MINICLAW_NOTIFY_EMAIL_SMTP_HOST",
  "MINICLAW_NOTIFY_EMAIL_SMTP_PORT",
  "MINICLAW_NOTIFY_EMAIL_USE_SSL",
  "MINICLAW_NOTIFY_EMAIL_USERNAME",
  "MINICLAW_NOTIFY_EMAIL_PASSWORD",
  "MINICLAW_NOTIFY_EMAIL_FROM",
  "MINICLAW_NOTIFY_EMAIL_TO",
] as const;

let tmpDir: string;
let previousEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.resetModules();
  tmpDir = mkdtempSync(join(tmpdir(), "miniclaw-config-"));
  previousEnv = {};
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key];
    process.env[key] = "";
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = previousEnv[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  rmSync(tmpDir, { recursive: true, force: true });
  vi.resetModules();
});

describe("config", () => {
  it("loads hierarchical yaml config", async () => {
    const mcpConfig = join(tmpDir, "claude.json");
    const memoryPath = join(tmpDir, "MEMORY.md");
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
routing:
  auto_reply_channels:
    - "chat-yaml"
  task_channels:
    - "task-yaml"
  channel_defaults:
    "task-yaml":
      cwd: "${tmpDir}"
  smart_router:
    enabled: true
    default_mode: suggest
    min_confirm_confidence: 0.6
    min_auto_confidence: 0.95
    confirm_channels: ["chat-yaml"]
    auto_task_channels: ["task-yaml"]
    llm_classifier:
      enabled: true
      only_when_ambiguous: false
      provider: openai_compatible
      model: router-mini
      timeout_ms: 7000
      fallback_to_codex: false
    confirmation:
      state: memory
      timeout_seconds: 300
    context:
      include_recent_when_referenced: true
      recent_turns: 4
      max_chars: 4000
    decision_log:
      enabled: true
      store: sqlite
      prompt_preview_chars: 120
      store_full_prompt: false
agent:
  provider: codex
  default_cwd: "${tmpDir}"
  max_concurrent_tasks: 4
  budget_usd: unlimited
  max_turns: 0
  chat_timeout_ms: 1000
  attachment_timeout_ms: 2000
  shutdown_drain_timeout_ms: 300000
  register_commands_on_start: true
runtime:
  default_agent: claude
agent_run_manager:
  enabled: true
  max_turns: 9
  timeout_ms: 12345
  max_messages: 55
  max_artifact_bytes: 98765
  max_spawn_depth: 2
  max_children_per_run: 4
  max_concurrent_runs: 3
  max_ping_pong_turns: 6
  cleanup_ttl_ms: 54321
  max_fix_iterations: 1
model:
  default_client: openai
im:
  default_transport: discord
  transports:
    feishu:
      enabled: true
      webhook_url: "https://open.feishu.cn/open-apis/bot/v2/hook/test"
      secret: "feishu-secret"
  routes:
    daily-watchlist-stock:
      targets:
        - transport: discord
          target: "1000000000000000000"
        - transport: feishu
          target: default
claude:
  model: claude-test
  setting_sources: [user, local]
  disable_hooks: false
codex:
  model: inherit
  reasoning_effort: inherit
  sandbox:
    task: inherit
    chat: read-only
  approval_policy: inherit
  web_search: cached
  timeout_ms: 3000
  network_access: inherit
mcp:
  config: "${mcpConfig}"
  allowlist: [exa, context7]
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${memoryPath}"
state:
  retention:
    chat_history_days: 14
    task_events_days: 30
    smart_router_decisions_days: 60
    incidents_days: 120
    repair_runs_days: 180
    market_forecasts_days: 365
    dry_run_default: false
tasks:
  trace_auto_attach:
    enabled: true
    on_failure: true
    min_duration_ms: 600000
    min_event_count: 25
    max_bytes: 65536
cron:
  active_window:
    enabled: true
    timezone: Asia/Shanghai
    start: "08:00"
    end: "00:00"
attachments:
  max_mb: 16
  max_count: 3
  audio_transcription:
    enabled: true
    provider: local_faster_whisper
    model: gpt-4o-transcribe
    local_model: small
    local_python: python-test
    local_device: cpu
    local_compute_type: int8
    max_mb: 20
    timeout_ms: 45000
    language: zh
connectivity:
  enabled: true
  interval_ms: 30000
  failure_threshold: 2
  request_timeout_ms: 5000
  general_test_url: "https://example.com/health"
  state_path: "${join(tmpDir, "connectivity.json")}"
startup_watchdog:
  enabled: true
  client_ready_timeout_ms: 45000
  macos_notification_enabled: false
doctor:
  enabled: true
  auto_diagnose_enabled: true
  scan_interval_ms: 60000
  summary_channel_id: "1000000000000000000"
  auto_repair_enabled: false
  auto_commit_enabled: true
  auto_push_enabled: false
  auto_restart_enabled: false
  max_repairs_per_day: 1
  max_parallel_repairs: 1
  max_patch_files: 4
  repair_worktree_root: "${join(tmpDir, "repairs")}"
  repair_commit_author_name: "yuanyunfan"
  repair_commit_author_email: "59247355+yuanyunfan@users.noreply.github.com"
  require_approval_for_main: true
  allowed_paths: ["src/**/*.ts", "docs/**/*.md"]
  blocked_paths: [".env", "~/.miniclaw/**"]
hookd:
  enabled: true
  socket_path: "${join(tmpDir, "hookd.sock")}"
  max_payload_bytes: 131072
  zombie_scan_interval_ms: 15000
  approval_timeout_ms: 120000
  stale_active_ms: 300000
  dashboard_channel_id: "1508369535659675668"
  dashboard_channel_name: "miniclaw-cli-sessions"
  dashboard_message_id: "1508369535659675669"
  dashboard_update_debounce_ms: 2500
  dashboard_limit: 12
notifications:
  email:
    enabled: true
    smtp_host: "smtp.example.com"
    smtp_port: 465
    use_ssl: true
    username: "notify@example.com"
    password: "pw"
    from: "notify@example.com"
    to: "owner@example.com"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.DISCORD_TOKEN = "token-env";

    const { config } = await import("../config.js");

    expect(config.configFile).toEqual({ path: cfg, loaded: true });
    expect(config.discord.clientId).toBe("client-yaml");
    expect(config.allowedUserId).toBe("user-yaml");
    expect(config.agentProvider).toBe("codex");
    expect(config.runtime.defaultAgent).toBe("claude");
    expect(config.agentRunManager.enabled).toBe(true);
    expect(config.agentRunManager.policy).toEqual({
      maxTurns: 9,
      timeoutMs: 12345,
      maxMessages: 55,
      maxArtifactBytes: 98765,
      maxSpawnDepth: 2,
      maxChildrenPerRun: 4,
      maxConcurrentRuns: 3,
      maxPingPongTurns: 6,
      cleanupTtlMs: 54321,
      maxFixIterations: 1,
    });
    expect(config.model).toBe("claude-test");
    expect(config.modelClient.defaultClient).toBe("openai");
    expect(config.im).toEqual({
      defaultTransport: "discord",
      transports: {
        discord: { enabled: true },
        feishu: {
          enabled: true,
          webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
          secret: "feishu-secret",
        },
        weixin: {
          enabled: false,
          pollEnabled: false,
          stateDir: undefined,
          defaultAccountId: undefined,
          allowedUserIds: [],
          taskBridgeChannelId: undefined,
        },
      },
      routes: {
        "daily-watchlist-stock": {
          targets: [
            { transport: "discord", target: "1000000000000000000" },
            { transport: "feishu", target: "default" },
          ],
        },
      },
    });
    expect(config.defaultCwd).toBe(tmpDir);
    expect(config.defaultBudgetUsd).toBeUndefined();
    expect(config.defaultMaxTurns).toBeUndefined();
    expect(config.codex.model).toBeUndefined();
    expect(config.codex.reasoningEffort).toBeUndefined();
    expect(config.codex.taskSandbox).toBeUndefined();
    expect(config.codex.chatSandbox).toBe("read-only");
    expect(config.codex.timeoutMs).toBe(3000);
    expect(config.shutdownDrainTimeoutMs).toBe(300000);
    expect(config.codex.networkAccess).toBeUndefined();
    expect(config.mcp).toEqual({ configPath: mcpConfig, allowlist: ["exa", "context7"] });
    expect(config.dbPath).toBe(join(tmpDir, "data.db"));
    expect(config.memoryPath).toBe(memoryPath);
    expect(config.state.retention).toEqual({
      chatHistoryDays: 14,
      taskEventsDays: 30,
      smartRouterDecisionsDays: 60,
      incidentsDays: 120,
      repairRunsDays: 180,
      marketForecastsDays: 365,
      dryRunDefault: false,
    });
    expect(config.taskChannelIds).toEqual(["task-yaml"]);
    expect(config.channelDefaults["task-yaml"]).toEqual({ cwd: tmpDir });
    expect(config.tasks.traceAutoAttach).toEqual({
      enabled: true,
      onFailure: true,
      minDurationMs: 600000,
      minEventCount: 25,
      maxBytes: 65536,
    });
    expect(config.cron.activeWindow).toEqual({
      enabled: true,
      timezone: "Asia/Shanghai",
      start: "08:00",
      end: "00:00",
    });
    expect(config.smartRouter).toMatchObject({
      enabled: true,
      defaultMode: "suggest",
      minConfirmConfidence: 0.6,
      minAutoConfidence: 0.95,
      confirmChannelIds: ["chat-yaml"],
      autoTaskChannelIds: ["task-yaml"],
      llmClassifier: {
        enabled: true,
        onlyWhenAmbiguous: false,
        provider: "openai_compatible",
        model: "router-mini",
        timeoutMs: 7000,
        fallbackToCodex: false,
      },
      confirmation: { state: "memory", timeoutSeconds: 300 },
      context: { includeRecentWhenReferenced: true, recentTurns: 4, maxChars: 4000 },
      decisionLog: { enabled: true, store: "sqlite", promptPreviewChars: 120, storeFullPrompt: false },
    });
    expect(config.connectivity).toEqual({
      enabled: true,
      intervalMs: 30000,
      failureThreshold: 2,
      requestTimeoutMs: 5000,
      generalTestUrl: "https://example.com/health",
      statePath: join(tmpDir, "connectivity.json"),
    });
    expect(config.startupWatchdog).toEqual({
      enabled: true,
      clientReadyTimeoutMs: 45000,
      macosNotificationEnabled: false,
    });
    expect(config.doctor).toEqual({
      enabled: true,
      autoDiagnoseEnabled: true,
      scanIntervalMs: 60000,
      summaryChannelId: "1000000000000000000",
      summaryChannelName: "miniclaw-auto-improve",
      autoRepairEnabled: false,
      autoCommitEnabled: true,
      autoPushEnabled: false,
      autoRestartEnabled: false,
      maxRepairsPerDay: 1,
      maxParallelRepairs: 1,
      maxPatchFiles: 4,
      repairWorktreeRoot: join(tmpDir, "repairs"),
      repairCommitAuthorName: "yuanyunfan",
      repairCommitAuthorEmail: "59247355+yuanyunfan@users.noreply.github.com",
      requireApprovalForMain: true,
      allowedPaths: ["src/**/*.ts", "docs/**/*.md"],
      blockedPaths: [".env", "~/.miniclaw/**"],
    });
    expect(config.hookd).toEqual({
      enabled: true,
      socketPath: join(tmpDir, "hookd.sock"),
      maxPayloadBytes: 131072,
      zombieScanIntervalMs: 15000,
      approvalTimeoutMs: 120000,
      staleActiveMs: 300000,
      dashboardChannelId: "1508369535659675668",
      dashboardChannelName: "miniclaw-cli-sessions",
      dashboardMessageId: "1508369535659675669",
      dashboardUpdateDebounceMs: 2500,
      dashboardLimit: 12,
    });
    expect(config.notifications.email).toMatchObject({
      enabled: true,
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      useSsl: true,
      username: "notify@example.com",
      password: "pw",
      from: "notify@example.com",
      to: "owner@example.com",
    });
    expect(config.maxAttachments).toBe(3);
    expect(config.maxAttachmentMb).toBe(16);
    expect(config.audioTranscription).toEqual({
      enabled: true,
      provider: "local_faster_whisper",
      model: "gpt-4o-transcribe",
      localModel: "small",
      localPython: "python-test",
      localDevice: "cpu",
      localComputeType: "int8",
      maxMb: 20,
      timeoutMs: 45000,
      language: "zh",
    });
  });

  it("defaults doctor summaries to the Auto Improve channel name and supports env override", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
agent:
  provider: codex
  default_cwd: "${tmpDir}"
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.DISCORD_TOKEN = "token-env";

    const { config } = await import("../config.js");

    expect(config.doctor.summaryChannelId).toBeUndefined();
    expect(config.doctor.summaryChannelName).toBe("miniclaw-auto-improve");
    expect(config.doctor.scanIntervalMs).toBe(7200000);
    expect(config.autoReplyChannelIds).toEqual(["*"]);
    expect(config.tasks.traceAutoAttach).toEqual({
      enabled: false,
      onFailure: true,
      minDurationMs: 0,
      minEventCount: 0,
      maxBytes: 120000,
    });
    expect(config.cron.activeWindow).toEqual({
      enabled: false,
      timezone: "Asia/Shanghai",
      start: "08:00",
      end: "00:00",
    });
    expect(config.agentRunManager.enabled).toBe(false);
    expect(config.agentRunManager.policy).toEqual({
      maxTurns: 12,
      timeoutMs: 1800000,
      maxMessages: 100,
      maxArtifactBytes: 1000000,
      maxSpawnDepth: 1,
      maxChildrenPerRun: 8,
      maxConcurrentRuns: 3,
      maxPingPongTurns: 8,
      cleanupTtlMs: 86400000,
      maxFixIterations: 2,
    });
    expect(config.state.retention).toEqual({
      chatHistoryDays: 90,
      taskEventsDays: 90,
      smartRouterDecisionsDays: 180,
      incidentsDays: 365,
      repairRunsDays: 365,
      marketForecastsDays: 730,
      dryRunDefault: true,
    });
    expect(config.audioTranscription).toEqual({
      enabled: true,
      provider: "auto",
      model: "gpt-4o-mini-transcribe",
      localModel: "base",
      localPython: "python3",
      localDevice: "cpu",
      localComputeType: "int8",
      maxMb: 25,
      timeoutMs: 120000,
      language: undefined,
    });
  });

  it("allows explicitly disabling no-mention channel replies", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
routing:
  auto_reply_channels: []
agent:
  provider: codex
  default_cwd: "${tmpDir}"
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.DISCORD_TOKEN = "token-env";

    const { config } = await import("../config.js");

    expect(config.autoReplyChannelIds).toEqual([]);
  });

  it("supports audio transcription env overrides", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
agent:
  provider: codex
  default_cwd: "${tmpDir}"
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.DISCORD_TOKEN = "token-env";
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_ENABLED = "false";
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_PROVIDER = "openai_compatible";
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_MODEL = "whisper-1";
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_MODEL = "medium";
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_PYTHON = "/opt/python";
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_DEVICE = "cuda";
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_COMPUTE_TYPE = "float16";
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_MAX_MB = "12";
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_TIMEOUT_MS = "90000";
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_LANGUAGE = "en";

    const { config } = await import("../config.js");

    expect(config.audioTranscription).toEqual({
      enabled: false,
      provider: "openai_compatible",
      model: "whisper-1",
      localModel: "medium",
      localPython: "/opt/python",
      localDevice: "cuda",
      localComputeType: "float16",
      maxMb: 12,
      timeoutMs: 90000,
      language: "en",
    });
  });

  it("supports task trace auto-attach env overrides", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
agent:
  provider: codex
  default_cwd: "${tmpDir}"
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.DISCORD_TOKEN = "token-env";
    process.env.MINICLAW_TASK_TRACE_AUTO_ATTACH_ENABLED = "true";
    process.env.MINICLAW_TASK_TRACE_AUTO_ATTACH_ON_FAILURE = "false";
    process.env.MINICLAW_TASK_TRACE_AUTO_ATTACH_MIN_DURATION_MS = "900000";
    process.env.MINICLAW_TASK_TRACE_AUTO_ATTACH_MIN_EVENT_COUNT = "42";
    process.env.MINICLAW_TASK_TRACE_AUTO_ATTACH_MAX_BYTES = "32768";

    const { config } = await import("../config.js");

    expect(config.tasks.traceAutoAttach).toEqual({
      enabled: true,
      onFailure: false,
      minDurationMs: 900000,
      minEventCount: 42,
      maxBytes: 32768,
    });
  });

  it("supports Agent Run Manager env override", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
agent:
  provider: codex
  default_cwd: "${tmpDir}"
agent_run_manager:
  enabled: false
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.DISCORD_TOKEN = "token-env";
    process.env.MINICLAW_AGENT_RUN_MANAGER_ENABLED = "true";
    process.env.MINICLAW_AGENT_RUN_MANAGER_MAX_TURNS = "7";
    process.env.MINICLAW_AGENT_RUN_MANAGER_CHILD_TIMEOUT_MS = "2222";
    process.env.MINICLAW_AGENT_RUN_MANAGER_MAX_MESSAGES = "44";
    process.env.MINICLAW_AGENT_RUN_MANAGER_MAX_ARTIFACT_BYTES = "3333";
    process.env.MINICLAW_AGENT_RUN_MANAGER_MAX_SPAWN_DEPTH = "0";
    process.env.MINICLAW_AGENT_RUN_MANAGER_MAX_CHILDREN_PER_RUN = "5";
    process.env.MINICLAW_AGENT_RUN_MANAGER_MAX_CONCURRENT_RUNS = "2";
    process.env.MINICLAW_AGENT_RUN_MANAGER_MAX_PING_PONG_TURNS = "1";
    process.env.MINICLAW_AGENT_RUN_MANAGER_CLEANUP_TTL_MS = "9999";
    process.env.MINICLAW_AGENT_RUN_MANAGER_MAX_FIX_ITERATIONS = "0";

    const { config } = await import("../config.js");

    expect(config.agentRunManager.enabled).toBe(true);
    expect(config.agentRunManager.policy).toEqual({
      maxTurns: 7,
      timeoutMs: 2222,
      maxMessages: 44,
      maxArtifactBytes: 3333,
      maxSpawnDepth: 0,
      maxChildrenPerRun: 5,
      maxConcurrentRuns: 2,
      maxPingPongTurns: 1,
      cleanupTtlMs: 9999,
      maxFixIterations: 0,
    });
  });

  it("supports state retention env overrides", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
agent:
  provider: codex
  default_cwd: "${tmpDir}"
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
state:
  retention:
    chat_history_days: 90
    task_events_days: 90
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.DISCORD_TOKEN = "token-env";
    process.env.MINICLAW_STATE_RETENTION_CHAT_HISTORY_DAYS = "7";
    process.env.MINICLAW_STATE_RETENTION_TASK_EVENTS_DAYS = "8";
    process.env.MINICLAW_STATE_RETENTION_SMART_ROUTER_DECISIONS_DAYS = "9";
    process.env.MINICLAW_STATE_RETENTION_INCIDENTS_DAYS = "10";
    process.env.MINICLAW_STATE_RETENTION_REPAIR_RUNS_DAYS = "11";
    process.env.MINICLAW_STATE_RETENTION_MARKET_FORECASTS_DAYS = "12";
    process.env.MINICLAW_STATE_RETENTION_DRY_RUN_DEFAULT = "false";

    const { config } = await import("../config.js");

    expect(config.state.retention).toEqual({
      chatHistoryDays: 7,
      taskEventsDays: 8,
      smartRouterDecisionsDays: 9,
      incidentsDays: 10,
      repairRunsDays: 11,
      marketForecastsDays: 12,
      dryRunDefault: false,
    });
  });

  it("supports doctor summary channel name env override", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
agent:
  provider: codex
  default_cwd: "${tmpDir}"
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.DISCORD_TOKEN = "token-env";
    process.env.MINICLAW_DOCTOR_SUMMARY_CHANNEL_NAME = "custom-auto-improve";

    const { config } = await import("../config.js");

    expect(config.doctor.summaryChannelName).toBe("custom-auto-improve");
  });

  it("supports doctor scan interval env override", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
agent:
  provider: codex
  default_cwd: "${tmpDir}"
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.DISCORD_TOKEN = "token-env";
    process.env.MINICLAW_DOCTOR_SCAN_INTERVAL_MS = "90000";

    const { config } = await import("../config.js");

    expect(config.doctor.scanIntervalMs).toBe(90000);
  });

  it("supports legacy top-level email SMTP config for notifications", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
agent:
  provider: codex
  default_cwd: "${tmpDir}"
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
email:
  smtp_host: "smtp.qq.com"
  smtp_port: 465
  use_ssl: true
  username: "notify@qq.com"
  password: "pw"
  to: "notify@qq.com"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.DISCORD_TOKEN = "token-env";

    const { config } = await import("../config.js");

    expect(config.notifications.email).toMatchObject({
      enabled: true,
      smtpHost: "smtp.qq.com",
      smtpPort: 465,
      useSsl: true,
      username: "notify@qq.com",
      password: "pw",
      to: "notify@qq.com",
    });
  });

  it("keeps legacy env keys as overrides and ignores blank env values", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
routing:
  task_channels: ["task-yaml"]
agent:
  provider: claude
  default_cwd: "${tmpDir}"
claude:
  model: claude-yaml
codex:
  model: yaml-model
mcp:
  allowlist: [exa]
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.DISCORD_TOKEN = "token-env";
    process.env.MINICLAW_AGENT_PROVIDER = "codex";
    process.env.MINICLAW_RUNTIME_DEFAULT_AGENT = "claude";
    process.env.MINICLAW_MODEL_DEFAULT_CLIENT = "raven";
    process.env.MINICLAW_ALLOWED_USER_ID = "user-env";
    process.env.MINICLAW_CODEX_MODEL = "env-model";
    process.env.MINICLAW_MCP_ALLOWLIST = "*";
    process.env.MINICLAW_TASK_CHANNELS = "";
    process.env.MINICLAW_SHUTDOWN_DRAIN_TIMEOUT_MS = "600000";

    const { config } = await import("../config.js");

    expect(config.agentProvider).toBe("codex");
    expect(config.runtime.defaultAgent).toBe("claude");
    expect(config.modelClient.defaultClient).toBe("raven");
    expect(config.smartRouter.llmClassifier.provider).toBe("raven");
    expect(config.allowedUserId).toBe("user-env");
    expect(config.codex.model).toBe("env-model");
    expect(config.mcp.allowlist).toEqual(["*"]);
    expect(config.taskChannelIds).toEqual(["task-yaml"]);
    expect(config.codex.timeoutMs).toBe(1800000);
    expect(config.shutdownDrainTimeoutMs).toBe(600000);
    expect(config.smartRouter.enabled).toBe(false);
    expect(config.smartRouter.llmClassifier.enabled).toBe(true);
    expect(config.smartRouter.llmClassifier.fallbackToCodex).toBe(false);
  });

  it("supports Raven classifier provider with inherited model", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
routing:
  smart_router:
    llm_classifier:
      provider: raven
      model: inherit
agent:
  provider: codex
  default_cwd: "${tmpDir}"
anthropic:
  base_url: "http://localhost:7024"
claude:
  model: claude-router
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.DISCORD_TOKEN = "token-env";
    process.env.ANTHROPIC_API_KEY = "raven-key";

    const { config } = await import("../config.js");

    expect(config.smartRouter.llmClassifier.provider).toBe("raven");
    expect(config.smartRouter.llmClassifier.model).toBeUndefined();
    expect(config.anthropicBaseUrl).toBe("http://localhost:7024");
  });

  it("preserves legacy blank budget and turn env values as unlimited", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
agent:
  provider: codex
  default_cwd: "${tmpDir}"
  budget_usd: 2
  max_turns: 8
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.DISCORD_TOKEN = "token-env";
    process.env.MINICLAW_DEFAULT_BUDGET_USD = "";
    process.env.MINICLAW_DEFAULT_MAX_TURNS = "";

    const { config } = await import("../config.js");

    expect(config.defaultBudgetUsd).toBeUndefined();
    expect(config.defaultMaxTurns).toBeUndefined();
  });

  it("enables E2E mode only with isolated temp config, storage, cwd, sender and scheduler settings", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  token: "token-yaml"
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
routing:
  channel_defaults:
    "task-yaml":
      cwd: "${join(tmpDir, "task-cwd")}"
agent:
  provider: codex
  default_cwd: "${tmpDir}"
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.MINICLAW_E2E_MODE = "true";
    process.env.MINICLAW_E2E_SENDER_USER_IDS = "sender-a,sender-b";
    process.env.MINICLAW_DISABLE_SCHEDULER = "true";
    process.env.MINICLAW_E2E_FAKE_AGENT = "true";

    const { assertE2eSafeRuntimePath, config } = await import("../config.js");

    expect(config.e2e).toMatchObject({
      mode: true,
      senderUserIds: ["sender-a", "sender-b"],
      disableScheduler: true,
      fakeAgent: true,
      tempRoot: tmpdir(),
    });
    expect(config.defaultCwd).toBe(tmpDir);
    expect(config.dbPath).toBe(join(tmpDir, "data.db"));
    expect(config.memoryPath).toBe(join(tmpDir, "MEMORY.md"));
    expect(() => assertE2eSafeRuntimePath("safe temp path", join(tmpDir, "nested"))).not.toThrow();
    expect(() => assertE2eSafeRuntimePath("unsafe runtime cwd", process.cwd())).toThrow(
      /E2E mode refuses unsafe runtime cwd outside system temp dir/
    );
  });

  it("fails closed when E2E mode has no sender allowlist", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  token: "token-yaml"
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
agent:
  provider: codex
  default_cwd: "${tmpDir}"
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.MINICLAW_E2E_MODE = "true";
    process.env.MINICLAW_DISABLE_SCHEDULER = "true";

    await expect(import("../config.js")).rejects.toThrow(/MINICLAW_E2E_SENDER_USER_IDS/);
  });

  it("fails closed when E2E mode does not disable the scheduler", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  token: "token-yaml"
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
agent:
  provider: codex
  default_cwd: "${tmpDir}"
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.MINICLAW_E2E_MODE = "true";
    process.env.MINICLAW_E2E_SENDER_USER_IDS = "sender-a";

    await expect(import("../config.js")).rejects.toThrow(/MINICLAW_DISABLE_SCHEDULER=true/);
  });

  it("fails closed when E2E mode points runtime cwd outside temp", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  token: "token-yaml"
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
agent:
  provider: codex
  default_cwd: "${process.cwd()}"
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.MINICLAW_E2E_MODE = "true";
    process.env.MINICLAW_E2E_SENDER_USER_IDS = "sender-a";
    process.env.MINICLAW_DISABLE_SCHEDULER = "true";

    await expect(import("../config.js")).rejects.toThrow(/MINICLAW_DEFAULT_CWD/);
  });

  it("fails closed when fake agent is enabled outside E2E mode", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  token: "token-yaml"
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
agent:
  provider: codex
  default_cwd: "${tmpDir}"
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.MINICLAW_E2E_FAKE_AGENT = "true";

    await expect(import("../config.js")).rejects.toThrow(/MINICLAW_E2E_FAKE_AGENT requires MINICLAW_E2E_MODE=true/);
  });
});
