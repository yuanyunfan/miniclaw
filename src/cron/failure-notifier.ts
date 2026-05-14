import "../proxy.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  type Message,
  type MessageCreateOptions,
  type MessageEditOptions,
  type SendableChannels,
} from "discord.js";
import type { CronJob } from "./types.js";
import { createLogger } from "../lib/log.js";
import { sendTextFanout } from "../im/delivery.js";

const log = createLogger("cron-failure");

const CUSTOM_ID_PREFIX = "miniclaw:cron:retry:";
const MAX_ERROR_CHARS = 500;

export interface CronFailureAlertRef {
  channelId: string;
  messageId?: string;
  message?: Pick<Message, "id" | "edit">;
}

export interface CronFailureDetails {
  /**
   * Retry-chain id used by the Discord retry button. This is intentionally
   * separate from cronRunId because one failure chain can contain many attempts.
   */
  runId: string;
  cronRunId?: string;
  taskId?: string;
  incidentId?: string;
  attempt: number;
  maxAttempts: number;
  durationMs: number;
  error: string;
  failedAt: Date;
  nextRetryAt?: Date;
}

export interface CronRecoveredDetails {
  runId: string;
  attempt: number;
  maxAttempts: number;
  durationMs: number;
  recoveredAt: Date;
}

export interface CronRetryButtonDetails {
  runId: string;
  label?: string;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0 && seconds > 0) return `${minutes}m${seconds}s`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function formatLocalTime(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function buildCronRetryCustomId(runId: string): string {
  return `${CUSTOM_ID_PREFIX}${runId}`;
}

export function parseCronRetryCustomId(customId: string): { runId: string } | null {
  if (!customId.startsWith(CUSTOM_ID_PREFIX)) return null;
  const runId = customId.slice(CUSTOM_ID_PREFIX.length).trim();
  if (!runId || runId.length > 64 || !/^[A-Za-z0-9_-]+$/.test(runId)) return null;
  return { runId };
}

export function sanitizeCronError(error: string, maxChars = MAX_ERROR_CHARS): string {
  let text = error
    .replace(/```/g, "'''")
    .replace(/\s+/g, " ")
    .trim();

  text = text.replace(/https?:\/\/[^\s)]+/g, (raw) => {
    try {
      const url = new URL(raw);
      return `${url.origin}${url.pathname}${url.search ? "?[redacted]" : ""}`;
    } catch {
      return "[url]";
    }
  });

  text = text.replace(
    /\b(token|access[_-]?token|refresh[_-]?token|authorization|cookie|password|passwd|secret|validate[_-]?key|session|sessionid|csrf|api[_-]?key)\s*[:=]\s*["']?[^,\s;&"']+/gi,
    "$1=[redacted]"
  );

  text = text.replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]");

  if (!text) return "unknown error";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 16).trimEnd()} ... (truncated)`;
}

function validRetryRunId(runId: string): boolean {
  return Boolean(runId) && runId.length <= 64 && /^[A-Za-z0-9_-]+$/.test(runId);
}

function retryButtonLabel(label?: string): string {
  const normalized = label?.replace(/\s+/g, " ").trim();
  if (!normalized) return "立即重新执行";
  return normalized.length <= 80 ? normalized : normalized.slice(0, 80);
}

export function buildCronRetryActionRows(buttons: CronRetryButtonDetails[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const validButtons = buttons.filter((button) => validRetryRunId(button.runId)).slice(0, 25);
  for (let i = 0; i < validButtons.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const button of validButtons.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(buildCronRetryCustomId(button.runId))
          .setLabel(retryButtonLabel(button.label))
          .setStyle(ButtonStyle.Primary)
      );
    }
    rows.push(row);
  }
  return rows;
}

function failureComponents(runId: string): ActionRowBuilder<ButtonBuilder>[] {
  return buildCronRetryActionRows([{ runId }]);
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function operatorHintLines(details: CronFailureDetails): string[] {
  const lines: string[] = [];
  if (details.cronRunId) {
    lines.push(`- Cron run: \`${details.cronRunId}\``);
    lines.push(`- Local detail: \`pnpm run cron:runs -- --id ${shortId(details.cronRunId)}\``);
  } else {
    lines.push(`- Retry chain: \`${details.runId}\``);
  }
  if (details.taskId) {
    lines.push(`- Task trace: \`/task-log id:${shortId(details.taskId)}\``);
  }
  if (details.incidentId) {
    lines.push(`- Incident: \`/incident view id:${shortId(details.incidentId)}\``);
  }
  return lines.length ? ["排查入口:", ...lines] : [];
}

export function buildCronFailurePayload(job: CronJob, details: CronFailureDetails): MessageCreateOptions & MessageEditOptions {
  const exhausted = details.attempt >= details.maxAttempts;
  const nextRetry = details.nextRetryAt
    ? `下一次自动重试: ${formatLocalTime(details.nextRetryAt)}`
    : exhausted
      ? "自动重试: 已耗尽"
      : "自动重试: 未计划";

  return {
    content: [
      "⏰ 定时任务执行失败",
      "",
      `任务: \`${job.name}\``,
      `类型: \`${job.type}\``,
      `失败时间: ${formatLocalTime(details.failedAt)}`,
      `尝试次数: ${details.attempt}/${details.maxAttempts}`,
      `耗时: ${formatDuration(details.durationMs)}`,
      `错误: ${sanitizeCronError(details.error)}`,
      nextRetry,
      "",
      ...operatorHintLines(details),
      "",
      "点击按钮可立即重新执行该定时任务。",
    ].join("\n").slice(0, 2000),
    components: failureComponents(details.runId),
  };
}

export function buildCronRecoveredPayload(job: CronJob, details: CronRecoveredDetails): MessageEditOptions {
  return {
    content: [
      "✅ 定时任务已恢复成功",
      "",
      `任务: \`${job.name}\``,
      `恢复时间: ${formatLocalTime(details.recoveredAt)}`,
      `成功尝试: ${details.attempt}/${details.maxAttempts}`,
      `耗时: ${formatDuration(details.durationMs)}`,
    ].join("\n").slice(0, 2000),
    components: [],
  };
}

export function buildCronRetryRequestedPayload(jobName: string, status: "woke" | "started"): MessageEditOptions {
  const action = status === "woke" ? "已唤醒等待中的自动重试" : "已启动一次立即重试";
  return {
    content: [
      "🔁 已请求立即重新执行定时任务",
      "",
      `任务: \`${jobName}\``,
      `状态: ${action}`,
      `请求时间: ${formatLocalTime(new Date())}`,
    ].join("\n").slice(0, 2000),
    components: [],
  };
}

async function fetchSendableChannel(client: Client, channelId: string): Promise<SendableChannels | null> {
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch && "isSendable" in ch && ch.isSendable()) return ch as SendableChannels;
  } catch (err) {
    log.error(`fetch channel ${channelId} failed:`, err);
  }
  return null;
}

export async function sendOrUpdateCronFailureAlert(
  client: Client,
  job: CronJob,
  details: CronFailureDetails,
  previous?: CronFailureAlertRef
): Promise<CronFailureAlertRef | undefined> {
  const payload = buildCronFailurePayload(job, details);
  const sendExtra = async () => {
    if (!job.delivery_route || typeof payload.content !== "string") return;
    const results = await sendTextFanout({
      client,
      fallbackDiscordTarget: job.channel,
      route: job.delivery_route,
      content: payload.content,
      extraOnly: true,
      failOnError: false,
      metadata: { cron_name: job.name, cron_type: job.type, alert_type: "cron_failure" },
    });
    for (const result of results) {
      if (result.error) {
        log.warn(`${job.name} extra IM cron failure alert to ${result.target.transport}:${result.target.target} failed:`, result.error);
      }
    }
  };

  if (previous?.message) {
    try {
      const edited = await previous.message.edit(payload);
      await sendExtra();
      return {
        channelId: previous.channelId,
        messageId: edited.id,
        message: edited,
      };
    } catch (err) {
      log.warn(`failed to edit cron failure alert for ${job.name}; sending a new alert:`, err);
    }
  }

  const channel = await fetchSendableChannel(client, job.channel);
  if (!channel) return previous;
  const message = await channel.send(payload);
  await sendExtra();
  return {
    channelId: job.channel,
    messageId: message.id,
    message,
  };
}

export async function updateCronRecoveredAlert(
  job: CronJob,
  details: CronRecoveredDetails,
  previous?: CronFailureAlertRef
): Promise<void> {
  if (!previous?.message) return;
  try {
    await previous.message.edit(buildCronRecoveredPayload(job, details));
  } catch (err) {
    log.warn(`failed to edit cron recovered alert for ${job.name}:`, err);
  }
}
