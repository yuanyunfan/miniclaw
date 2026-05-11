import "./proxy.js";
import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import yaml from "js-yaml";
import { createLogger } from "./lib/log.js";

const log = createLogger("config");

export type AgentProvider = "claude" | "codex";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type CodexApprovalPolicy = "never" | "on-request" | "on-failure" | "untrusted";
export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type CodexWebSearchMode = "disabled" | "cached" | "live";
export type ClaudeSettingSource = "user" | "project" | "local";
export type SmartRouterDefaultMode = "suggest" | "confirm" | "auto";
export type SmartRouterClassifierProvider = "auto" | "raven" | "anthropic" | "openai" | "openai_compatible" | "codex";
export type AudioTranscriptionProvider = "auto" | "openai" | "openai_compatible" | "local_faster_whisper";

export interface SmtpEmailNotificationConfig {
  enabled: boolean;
  smtpHost?: string;
  smtpPort: number;
  useSsl: boolean;
  username?: string;
  password?: string;
  from?: string;
  to?: string;
}

type ConfigObject = Record<string, unknown>;
type ConfigPath = readonly string[];

const DEFAULT_CONFIG_PATH = join(homedir(), ".miniclaw", "config.yaml");

function isPlainObject(v: unknown): v is ConfigObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function resolveHome(p: string): string {
  const trimmed = p.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

function envOptional(key: string): string | undefined {
  const v = process.env[key];
  if (v === undefined) return undefined;
  const trimmed = v.trim();
  return trimmed ? trimmed : undefined;
}

function envRaw(key: string): string | undefined {
  return process.env[key];
}

function isDefaultConfigReference(raw: string | undefined): boolean {
  if (!raw) return true;
  const trimmed = raw.trim();
  return trimmed === "~/.miniclaw/config.yaml" || trimmed === DEFAULT_CONFIG_PATH;
}

function loadYamlConfig(
  path: string,
  explicitPath: boolean,
  rawPath: string | undefined
): { data: ConfigObject; loaded: boolean } {
  if (!existsSync(path)) {
    if (explicitPath && !isDefaultConfigReference(rawPath)) {
      throw new Error(`MINICLAW_CONFIG points to a missing file: ${path}`);
    }
    return { data: {}, loaded: false };
  }

  const raw = readFileSync(path, "utf8");
  const parsed = yaml.load(raw) ?? {};
  if (!isPlainObject(parsed)) {
    throw new Error(`MiniClaw config must be a YAML object: ${path}`);
  }

  return { data: parsed, loaded: true };
}

const configuredConfigPath = envOptional("MINICLAW_CONFIG");
const configPath = resolveHome(configuredConfigPath ?? DEFAULT_CONFIG_PATH);
const configFile = loadYamlConfig(configPath, configuredConfigPath !== undefined, configuredConfigPath);

function getPath(data: ConfigObject, path: ConfigPath): unknown {
  let current: unknown = data;
  for (const segment of path) {
    if (!isPlainObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function normalizePaths(paths: ConfigPath | readonly ConfigPath[]): ConfigPath[] {
  if (paths.length === 0) return [];
  return typeof paths[0] === "string" ? [paths as ConfigPath] : [...(paths as readonly ConfigPath[])];
}

function normalizeKeys(keys: string | readonly string[]): string[] {
  return typeof keys === "string" ? [keys] : [...keys];
}

function optionName(paths: ConfigPath | readonly ConfigPath[], envKeys: string | readonly string[]): string {
  const envPart = normalizeKeys(envKeys).join(" / ");
  const pathPart = normalizePaths(paths).map((p) => p.join(".")).join(" / ");
  return `${envPart || "(no env)"} / ${pathPart}`;
}

function readRaw(
  paths: ConfigPath | readonly ConfigPath[],
  envKeys: string | readonly string[],
  fallback?: unknown
): unknown {
  for (const key of normalizeKeys(envKeys)) {
    const v = envOptional(key);
    if (v !== undefined) return v;
  }

  for (const path of normalizePaths(paths)) {
    const v = getPath(configFile.data, path);
    if (v !== undefined && v !== null) return v;
  }

  return fallback;
}

function scalarString(raw: unknown, name: string): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (Array.isArray(raw) || isPlainObject(raw)) {
    throw new Error(`Invalid config ${name}: expected string`);
  }
  const v = String(raw).trim();
  return v ? v : undefined;
}

function requiredString(
  paths: ConfigPath | readonly ConfigPath[],
  envKeys: string | readonly string[],
  fallback?: string
): string {
  const name = optionName(paths, envKeys);
  const v = scalarString(readRaw(paths, envKeys, fallback), name);
  if (!v) throw new Error(`Missing config: ${name}`);
  return v;
}

function optionalString(paths: ConfigPath | readonly ConfigPath[], envKeys: string | readonly string[]): string | undefined {
  return scalarString(readRaw(paths, envKeys), optionName(paths, envKeys));
}

function stringOrInherit(
  paths: ConfigPath | readonly ConfigPath[],
  envKeys: string | readonly string[],
  fallback: string
): string | undefined {
  const name = optionName(paths, envKeys);
  const raw = scalarString(readRaw(paths, envKeys, fallback), name);
  if (!raw) return fallback;
  return raw.toLowerCase() === "inherit" ? undefined : raw;
}

function oneOf<T extends string>(
  paths: ConfigPath | readonly ConfigPath[],
  envKeys: string | readonly string[],
  fallback: T,
  allowed: readonly T[]
): T {
  const name = optionName(paths, envKeys);
  const raw = scalarString(readRaw(paths, envKeys, fallback), name)?.toLowerCase() ?? fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new Error(`Invalid config ${name}: ${raw}. Expected one of: ${allowed.join(", ")}`);
}

function oneOfOrInherit<T extends string>(
  paths: ConfigPath | readonly ConfigPath[],
  envKeys: string | readonly string[],
  fallback: T,
  allowed: readonly T[]
): T | undefined {
  const name = optionName(paths, envKeys);
  const raw = scalarString(readRaw(paths, envKeys, fallback), name)?.toLowerCase() ?? fallback;
  if (raw === "inherit") return undefined;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new Error(`Invalid config ${name}: ${raw}. Expected one of: inherit, ${allowed.join(", ")}`);
}

function boolValue(
  paths: ConfigPath | readonly ConfigPath[],
  envKeys: string | readonly string[],
  fallback: boolean
): boolean {
  const raw = readRaw(paths, envKeys, fallback);
  if (typeof raw === "boolean") return raw;
  const name = optionName(paths, envKeys);
  const s = scalarString(raw, name)?.toLowerCase();
  if (s === "true") return true;
  if (s === "false") return false;
  throw new Error(`Invalid config ${name}: ${String(raw)}. Expected true or false`);
}

function boolOrInherit(
  paths: ConfigPath | readonly ConfigPath[],
  envKeys: string | readonly string[],
  fallback: boolean
): boolean | undefined {
  const raw = readRaw(paths, envKeys, fallback);
  if (typeof raw === "boolean") return raw;
  const name = optionName(paths, envKeys);
  const s = scalarString(raw, name)?.toLowerCase();
  if (s === "inherit") return undefined;
  if (s === "true") return true;
  if (s === "false") return false;
  throw new Error(`Invalid config ${name}: ${String(raw)}. Expected one of: inherit, true, false`);
}

function stringArray(
  paths: ConfigPath | readonly ConfigPath[],
  envKeys: string | readonly string[],
  fallback: readonly string[] = []
): string[] {
  const raw = readRaw(paths, envKeys, fallback);
  const name = optionName(paths, envKeys);
  if (Array.isArray(raw)) {
    return raw.map((v) => scalarString(v, name)).filter((v): v is string => Boolean(v));
  }

  const s = scalarString(raw, name);
  if (!s) return [];
  const lower = s.toLowerCase();
  if (lower === "none" || lower === "disabled" || lower === "false") return [];
  return s.split(",").map((v) => v.trim()).filter(Boolean);
}

function settingSources(paths: ConfigPath, envKeys: string | readonly string[], fallback: readonly string[]): ClaudeSettingSource[] {
  const allowed: readonly ClaudeSettingSource[] = ["user", "project", "local"];
  const values = stringArray(paths, envKeys, fallback).map((v) => v.toLowerCase());
  const seen = new Set<ClaudeSettingSource>();
  for (const value of values) {
    if (!(allowed as readonly string[]).includes(value)) {
      throw new Error(`Invalid config ${optionName(paths, envKeys)}: ${value}. Expected one of: ${allowed.join(", ")}, none`);
    }
    seen.add(value as ClaudeSettingSource);
  }
  return [...seen];
}

function positiveNumber(paths: ConfigPath | readonly ConfigPath[], envKeys: string | readonly string[], fallback: number): number {
  const raw = readRaw(paths, envKeys, fallback);
  const name = optionName(paths, envKeys);
  const n = typeof raw === "number" ? raw : Number(scalarString(raw, name));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid config ${name}: expected positive number`);
  return n;
}

function confidenceNumber(paths: ConfigPath, envKeys: string | readonly string[], fallback: number): number {
  const raw = readRaw(paths, envKeys, fallback);
  const name = optionName(paths, envKeys);
  const n = typeof raw === "number" ? raw : Number(scalarString(raw, name));
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`Invalid config ${name}: expected number between 0 and 1`);
  }
  return n;
}

function positiveInt(paths: ConfigPath | readonly ConfigPath[], envKeys: string | readonly string[], fallback: number): number {
  const n = positiveNumber(paths, envKeys, fallback);
  if (!Number.isInteger(n)) throw new Error(`Invalid config ${optionName(paths, envKeys)}: expected positive integer`);
  return n;
}

function numberOrUnlimited(paths: ConfigPath, envKeys: string | readonly string[], fallback: number): number | undefined {
  const name = optionName(paths, envKeys);

  for (const key of normalizeKeys(envKeys)) {
    const env = envRaw(key);
    if (env !== undefined) return parseNumberOrUnlimited(env, name);
  }

  return parseNumberOrUnlimited(readRaw(paths, [], fallback), name);
}

function channelDefaults(paths: ConfigPath, envKeys: string | readonly string[]): Record<string, { cwd: string }> {
  const raw = readRaw(paths, envKeys, {});
  const name = optionName(paths, envKeys);
  if (raw === undefined || raw === null) return {};
  if (!isPlainObject(raw)) {
    throw new Error(`Invalid config ${name}: expected object keyed by Discord channel id`);
  }

  const out: Record<string, { cwd: string }> = {};
  for (const [channelId, value] of Object.entries(raw)) {
    if (!channelId.trim()) continue;
    if (!isPlainObject(value)) {
      throw new Error(`Invalid config ${name}.${channelId}: expected object`);
    }
    const cwdRaw = scalarString(value.cwd, `${name}.${channelId}.cwd`);
    if (cwdRaw) out[channelId] = { cwd: resolveHome(cwdRaw) };
  }
  return out;
}

function parseNumberOrUnlimited(raw: unknown, name: string): number | undefined {
  if (typeof raw === "number") {
    if (raw === 0) return undefined;
    return Number.isFinite(raw) && raw > 0 ? raw : undefined;
  }
  const s = scalarString(raw, name)?.toLowerCase();
  if (!s || s === "0" || s === "unlimited" || s === "none") return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const agentProvider = oneOf<AgentProvider>(["agent", "provider"], "MINICLAW_AGENT_PROVIDER", "claude", [
  "claude",
  "codex",
]);
const claudeModel = requiredString(["claude", "model"], ["MINICLAW_CLAUDE_MODEL", "MINICLAW_MODEL"], "claude-opus-4-7");
const codexModel = stringOrInherit(["codex", "model"], "MINICLAW_CODEX_MODEL", "gpt-5.5");
const autoReplyChannelIds = stringArray(["routing", "auto_reply_channels"], "MINICLAW_AUTO_REPLY_CHANNELS", ["*"]);
const taskChannelIds = stringArray(["routing", "task_channels"], "MINICLAW_TASK_CHANNELS");
const channelDefaultConfig = channelDefaults(["routing", "channel_defaults"], []);
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

function isUnderDir(path: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertE2eTempPath(kind: string, path: string): void {
  if (!e2eMode) return;
  if (!isUnderDir(path, tmpdir())) {
    throw new Error(`E2E mode requires ${kind} to be under system temp dir ${tmpdir()}: ${path}`);
  }
}

if (e2eMode) {
  if (!configuredConfigPath) {
    throw new Error("E2E mode requires MINICLAW_CONFIG to point to a temp config file");
  }
  if (!e2eSenderUserIds.length) {
    throw new Error("E2E mode requires MINICLAW_E2E_SENDER_USER_IDS");
  }
  if (!disableScheduler) {
    throw new Error("E2E mode requires MINICLAW_DISABLE_SCHEDULER=true");
  }
  assertE2eTempPath("MINICLAW_CONFIG", configPath);
  assertE2eTempPath("MINICLAW_DB_PATH", dbPath);
  assertE2eTempPath("MINICLAW_MEMORY_PATH", memoryPath);
  assertE2eTempPath("MINICLAW_DEFAULT_CWD", defaultCwd);
  for (const [channelId, value] of Object.entries(channelDefaultConfig)) {
    assertE2eTempPath(`routing.channel_defaults.${channelId}.cwd`, value.cwd);
  }
} else if (e2eFakeAgent) {
  throw new Error("MINICLAW_E2E_FAKE_AGENT requires MINICLAW_E2E_MODE=true");
}

export const config = {
  configFile: {
    path: configPath,
    loaded: configFile.loaded,
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
      ["minimal", "low", "medium", "high", "xhigh"]
    ),
    taskSandbox: oneOfOrInherit<CodexSandboxMode>(
      ["codex", "sandbox", "task"],
      "MINICLAW_CODEX_TASK_SANDBOX",
      "workspace-write",
      ["read-only", "workspace-write", "danger-full-access"]
    ),
    chatSandbox: oneOfOrInherit<CodexSandboxMode>(
      ["codex", "sandbox", "chat"],
      "MINICLAW_CODEX_CHAT_SANDBOX",
      "read-only",
      ["read-only", "workspace-write", "danger-full-access"]
    ),
    approvalPolicy: oneOfOrInherit<CodexApprovalPolicy>(
      ["codex", "approval_policy"],
      "MINICLAW_CODEX_APPROVAL_POLICY",
      "never",
      ["never", "on-request", "on-failure", "untrusted"]
    ),
    webSearchMode: oneOfOrInherit<CodexWebSearchMode>(
      ["codex", "web_search"],
      "MINICLAW_CODEX_WEB_SEARCH",
      "live",
      ["disabled", "cached", "live"]
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
  smartRouter: {
    enabled: smartRouterEnabled,
    defaultMode: oneOf<SmartRouterDefaultMode>(
      ["routing", "smart_router", "default_mode"],
      "MINICLAW_SMART_ROUTER_DEFAULT_MODE",
      "confirm",
      ["suggest", "confirm", "auto"]
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
        ["auto", "raven", "anthropic", "openai", "openai_compatible", "codex"]
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
      ["auto", "openai", "openai_compatible", "local_faster_whisper"]
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
  if (!config.e2e.mode) return;
  if (!isUnderDir(path, config.e2e.tempRoot)) {
    throw new Error(`E2E mode refuses ${kind} outside system temp dir ${config.e2e.tempRoot}: ${path}`);
  }
}
