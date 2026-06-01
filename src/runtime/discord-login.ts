import { createLogger } from "../lib/log.js";

const log = createLogger("discord-login");

export const DEFAULT_DISCORD_LOGIN_RETRY_DELAYS_MS = [
  10 * 60_000,
  20 * 60_000,
  40 * 60_000,
] as const;

export interface DiscordLoginClient {
  login(token: string): Promise<string>;
  destroy(): Promise<void> | void;
}

export interface DiscordLoginFailureEvent {
  attempt: number;
  maxAttempts: number;
  error: unknown;
  occurredAt: string;
  final: boolean;
  nextRetryDelayMs?: number;
}

export type DiscordLoginResult<T extends DiscordLoginClient> =
  | { ok: true; client: T; attempts: number }
  | { ok: false; attempts: number; error: unknown };

export interface DiscordLoginRetryOptions {
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  onFailure?: (event: DiscordLoginFailureEvent) => Promise<void> | void;
}

export interface DiscordLoginFailureAlertMessage {
  subject: string;
  text: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(err: unknown): string {
  if (!err) return "";
  return (err instanceof Error ? err.message : String(err))
    .replace(/(password|pass|token|secret|authorization|cookie|session)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
    .replace(/\b[A-Za-z0-9_./+=-]{32,}\b/g, "[redacted]")
    .slice(0, 500);
}

function formatDelay(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

async function destroyAfterFailedLogin(client: DiscordLoginClient): Promise<void> {
  try {
    await client.destroy();
  } catch (err) {
    log.warn("failed to destroy Discord client after login failure:", err);
  }
}

export function buildDiscordLoginFailureAlert(event: DiscordLoginFailureEvent): DiscordLoginFailureAlertMessage {
  const retryLine = event.final
    ? "重试: 已用尽启动重试预算，进程将只保留非 Discord IM gateway。"
    : `重试: ${formatDelay(event.nextRetryDelayMs ?? 0)} 后进行第 ${event.attempt + 1}/${event.maxAttempts} 次登录。`;
  return {
    subject: "MiniClaw Discord 登录失败",
    text: [
      "MiniClaw Discord 登录失败",
      "",
      `时间: ${event.occurredAt}`,
      `尝试: ${event.attempt}/${event.maxAttempts}`,
      retryLine,
      `错误: ${errorText(event.error) || "unknown"}`,
      "",
      "影响: Discord chat/task/cron 推送当前不可用。",
      "建议: 检查 VPN、代理、Discord 出站链路和 PM2 日志；链路恢复后也可以执行 `pnpm safe-restart` 立即恢复。",
    ].join("\n"),
  };
}

export async function loginDiscordWithRetry<T extends DiscordLoginClient>(
  createClient: () => T,
  token: string,
  options: DiscordLoginRetryOptions = {}
): Promise<DiscordLoginResult<T>> {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_DISCORD_LOGIN_RETRY_DELAYS_MS;
  const maxAttempts = retryDelaysMs.length + 1;
  const sleepFn = options.sleep ?? sleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = createClient();
    try {
      await client.login(token);
      return { ok: true, client, attempts: attempt };
    } catch (err) {
      await destroyAfterFailedLogin(client);
      const nextRetryDelayMs = retryDelaysMs[attempt - 1];
      const final = nextRetryDelayMs === undefined;
      const event: DiscordLoginFailureEvent = {
        attempt,
        maxAttempts,
        error: err,
        occurredAt: new Date().toISOString(),
        final,
        ...(nextRetryDelayMs === undefined ? {} : { nextRetryDelayMs }),
      };
      try {
        await options.onFailure?.(event);
      } catch (notifyErr) {
        log.warn("Discord login failure notifier failed:", notifyErr);
      }

      if (final) return { ok: false, attempts: attempt, error: err };

      log.warn(
        `Discord bot login failed attempt=${attempt}/${maxAttempts}; ` +
        `retrying in ${formatDelay(nextRetryDelayMs)}: ${errorText(err) || "unknown"}`
      );
      await sleepFn(nextRetryDelayMs);
    }
  }

  return { ok: false, attempts: maxAttempts, error: new Error("Discord login retry loop exhausted") };
}

export const __testables = {
  errorText,
  formatDelay,
};
