import "./proxy.js";
import { resolve } from "path";
import { homedir } from "os";
import { createLogger } from "./lib/log.js";

const log = createLogger("config");

export type AgentProvider = "claude" | "codex";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type CodexApprovalPolicy = "never" | "on-request" | "on-failure" | "untrusted";
export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type CodexWebSearchMode = "disabled" | "cached" | "live";

function resolveHome(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(2)) : resolve(p);
}

function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing env: ${key}`);
  return v;
}

function envOptional(key: string): string | undefined {
  const v = process.env[key];
  if (v === undefined) return undefined;
  const trimmed = v.trim();
  return trimmed ? trimmed : undefined;
}

function envOneOf<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  const configured = process.env[key]?.trim();
  const raw = (configured ? configured : fallback).toLowerCase();
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new Error(`Invalid env ${key}: ${raw}. Expected one of: ${allowed.join(", ")}`);
}

// 把 env 字符串解析为 number。空字符串 / "0" / "unlimited" 都视为"无限制"返回 undefined
function envNumberOrUnlimited(key: string, fallback: string): number | undefined {
  const raw = (process.env[key] ?? fallback).trim().toLowerCase();
  if (raw === "" || raw === "0" || raw === "unlimited" || raw === "none") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function envNumber(key: string, fallback: string): number {
  const n = Number(process.env[key] ?? fallback);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid env ${key}: expected positive number`);
  return n;
}

function envPositiveInt(key: string, fallback: string): number {
  const raw = (process.env[key] ?? fallback).trim();
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid env ${key}: expected positive integer`);
  return n;
}

const agentProvider = envOneOf<AgentProvider>("MINICLAW_AGENT_PROVIDER", "claude", ["claude", "codex"]);
const claudeModel = envOptional("MINICLAW_CLAUDE_MODEL") ?? env("MINICLAW_MODEL", "claude-opus-4-7");
const codexModel = envOptional("MINICLAW_CODEX_MODEL") ?? "gpt-5.5";

export const config = {
  discord: {
    token: env("DISCORD_TOKEN"),
    clientId: env("DISCORD_CLIENT_ID"),
    guildId: env("DISCORD_GUILD_ID"),
  },
  agentProvider,
  anthropicApiKey: agentProvider === "claude" ? env("ANTHROPIC_API_KEY") : envOptional("ANTHROPIC_API_KEY"),
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL,
  openaiApiKey: envOptional("OPENAI_API_KEY"),
  openaiBaseUrl: envOptional("OPENAI_BASE_URL"),
  allowedUserId: env("MINICLAW_ALLOWED_USER_ID"),
  defaultCwd: resolveHome(env("MINICLAW_DEFAULT_CWD", "~/Code")),
  maxConcurrentTasks: envPositiveInt("MINICLAW_MAX_CONCURRENT_TASKS", "3"),
  defaultBudgetUsd: envNumberOrUnlimited("MINICLAW_DEFAULT_BUDGET_USD", "1.0"),
  defaultMaxTurns: envNumberOrUnlimited("MINICLAW_DEFAULT_MAX_TURNS", "30"),
  chatTimeoutMs: envNumber("MINICLAW_CHAT_TIMEOUT_MS", "180000"),
  attachmentTimeoutMs: envNumber("MINICLAW_ATTACHMENT_TIMEOUT_MS", "30000"),
  registerCommandsOnStart: envOneOf<"true" | "false">(
    "MINICLAW_REGISTER_COMMANDS_ON_START",
    "false",
    ["true", "false"]
  ) === "true",
  // Backward-compatible alias used by older code paths. New provider-aware code
  // should prefer claudeModel / codex.model.
  model: agentProvider === "claude" ? claudeModel : codexModel,
  claudeModel,
  codex: {
    model: codexModel,
    reasoningEffort: envOneOf<CodexReasoningEffort>(
      "MINICLAW_CODEX_REASONING_EFFORT",
      "medium",
      ["minimal", "low", "medium", "high", "xhigh"]
    ),
    taskSandbox: envOneOf<CodexSandboxMode>(
      "MINICLAW_CODEX_TASK_SANDBOX",
      "workspace-write",
      ["read-only", "workspace-write", "danger-full-access"]
    ),
    chatSandbox: envOneOf<CodexSandboxMode>(
      "MINICLAW_CODEX_CHAT_SANDBOX",
      "read-only",
      ["read-only", "workspace-write", "danger-full-access"]
    ),
    approvalPolicy: envOneOf<CodexApprovalPolicy>(
      "MINICLAW_CODEX_APPROVAL_POLICY",
      "never",
      ["never", "on-request", "on-failure", "untrusted"]
    ),
    webSearchMode: envOneOf<CodexWebSearchMode>(
      "MINICLAW_CODEX_WEB_SEARCH",
      "live",
      ["disabled", "cached", "live"]
    ),
    timeoutMs: envNumber("MINICLAW_CODEX_TIMEOUT_MS", "900000"),
    networkAccess: envOneOf<"true" | "false">("MINICLAW_CODEX_NETWORK_ACCESS", "true", ["true", "false"]) === "true",
  },
  autoReplyChannelIds: (() => {
    const ids = env("MINICLAW_AUTO_REPLY_CHANNELS", "").split(",").filter(Boolean);
    if (!ids.length) log.warn("MINICLAW_AUTO_REPLY_CHANNELS 未配置，所有频道需 @mention 触发");
    return ids;
  })(),
  dbPath: resolveHome(env("MINICLAW_DB_PATH", "~/.miniclaw/data.db")),
  maxAttachmentMb: envNumber("MINICLAW_MAX_ATTACHMENT_MB", "32"),
  maxAttachments: envPositiveInt("MINICLAW_MAX_ATTACHMENTS", "10"),
} as const;
