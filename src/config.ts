import "./proxy.js";
import { resolve } from "path";
import { homedir } from "os";
import { createLogger } from "./lib/log.js";

const log = createLogger("config");

function resolveHome(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(2)) : resolve(p);
}

function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing env: ${key}`);
  return v;
}

// 把 env 字符串解析为 number。空字符串 / "0" / "unlimited" 都视为"无限制"返回 undefined
function envNumberOrUnlimited(key: string, fallback: string): number | undefined {
  const raw = (process.env[key] ?? fallback).trim().toLowerCase();
  if (raw === "" || raw === "0" || raw === "unlimited" || raw === "none") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export const config = {
  discord: {
    token: env("DISCORD_TOKEN"),
    clientId: env("DISCORD_CLIENT_ID"),
    guildId: env("DISCORD_GUILD_ID"),
  },
  anthropicApiKey: env("ANTHROPIC_API_KEY"),
  allowedUserId: env("MINICLAW_ALLOWED_USER_ID"),
  defaultCwd: resolveHome(env("MINICLAW_DEFAULT_CWD", "~/Code")),
  maxConcurrentTasks: Number(env("MINICLAW_MAX_CONCURRENT_TASKS", "3")),
  defaultBudgetUsd: envNumberOrUnlimited("MINICLAW_DEFAULT_BUDGET_USD", "1.0"),
  defaultMaxTurns: envNumberOrUnlimited("MINICLAW_DEFAULT_MAX_TURNS", "30"),
  model: env("MINICLAW_MODEL", "claude-sonnet-4-6"),
  autoReplyChannelIds: (() => {
    const ids = env("MINICLAW_AUTO_REPLY_CHANNELS", "").split(",").filter(Boolean);
    if (!ids.length) log.warn("MINICLAW_AUTO_REPLY_CHANNELS 未配置，所有频道需 @mention 触发");
    return ids;
  })(),
  dbPath: resolveHome(env("MINICLAW_DB_PATH", "~/.miniclaw/data.db")),
  maxAttachmentMb: Number(env("MINICLAW_MAX_ATTACHMENT_MB", "32")),
  maxAttachments: Number(env("MINICLAW_MAX_ATTACHMENTS", "10")),
} as const;
