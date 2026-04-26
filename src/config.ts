import "./proxy.js";
import { resolve } from "path";
import { homedir } from "os";

function resolveHome(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(2)) : resolve(p);
}

function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing env: ${key}`);
  return v;
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
  defaultBudgetUsd: Number(env("MINICLAW_DEFAULT_BUDGET_USD", "1.0")),
  defaultMaxTurns: Number(env("MINICLAW_DEFAULT_MAX_TURNS", "30")),
  model: env("MINICLAW_MODEL", "claude-sonnet-4-6"),
  autoReplyChannelIds: env("MINICLAW_AUTO_REPLY_CHANNELS", "").split(",").filter(Boolean),
  dbPath: resolveHome(env("MINICLAW_DB_PATH", "~/.miniclaw/data.db")),
} as const;
