import type { Client, SendableChannels } from "discord.js";
import { loadCronJobs } from "../cron/loader.js";
import { createLogger } from "../lib/log.js";
import type { CronRunRow } from "../store/cron-runs.js";
import {
  enqueueRecoveryOutbox,
  listCronRunsMissingAlerts,
  listRecoveryOutbox,
  markCronRunAlertDelivered,
  markRecoveryOutboxAttemptFailed,
  markRecoveryOutboxDelivered,
  type RecoveryOutboxRow,
} from "../store/db.js";
import type { ConnectivitySnapshot } from "./connectivity-core.js";

const log = createLogger("recovery-outbox");

interface CronFailureRecoveryPayload {
  job_name: string;
  job_type: string;
  status: string;
  cron_run_id: string;
  task_id?: string | null;
  incident_id?: string | null;
  attempt: number;
  max_attempts?: number;
  failed_at: string;
  error_category?: string | null;
  error_message?: string | null;
  alert_error?: string | null;
  connectivity_status?: string | null;
  outage_started_at?: string | null;
}

interface TaskResultDeliveryPayload {
  task_id: string;
  job_name?: string | null;
  route?: string | null;
  success: boolean;
  duration_ms?: number;
  messages: string[];
  created_at: string;
  delivery_error?: string | null;
}

export interface EnqueueCronFailureRecoveryInput {
  channelId: string;
  cronRunId: string;
  jobName: string;
  jobType: string;
  status: string;
  attempt: number;
  failedAt: Date | string;
  maxAttempts?: number;
  taskId?: string | null;
  incidentId?: string | null;
  errorCategory?: string | null;
  errorMessage?: string | null;
  alertError?: string | null;
  connectivityStatus?: string | null;
  outageStartedAt?: string | null;
}

export interface EnqueueTaskResultDeliveryInput {
  channelId: string;
  taskId: string;
  messages: string[];
  success: boolean;
  jobName?: string | null;
  route?: string | null;
  durationMs?: number;
  deliveryError?: string | null;
}

export interface FlushRecoveryOutboxResult {
  cronAlertsDelivered: number;
  taskDeliveriesDelivered: number;
  failedAttempts: number;
  backfilledCronAlerts: number;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function sanitizeError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text
    .replace(/(password|pass|token|secret|authorization|cookie|session)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
    .replace(/\b[A-Za-z0-9_./+=-]{32,}\b/g, "[redacted]")
    .slice(0, 1500);
}

function parseJsonObject<T>(row: RecoveryOutboxRow): T | undefined {
  try {
    const parsed = JSON.parse(row.payload_json) as T;
    if (!parsed || typeof parsed !== "object") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function shortId(id?: string | null): string {
  return id ? id.slice(0, 8) : "";
}

function maxAttemptsFromError(message?: string | null): number | undefined {
  const match = message?.match(/attempt\s+\d+\/(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function cronPayloadFromRow(row: CronRunRow, channelId: string, snapshot?: ConnectivitySnapshot): CronFailureRecoveryPayload {
  return {
    job_name: row.job_name,
    job_type: row.job_type,
    status: row.status,
    cron_run_id: row.id,
    task_id: row.task_id,
    incident_id: row.incident_id,
    attempt: row.attempt,
    max_attempts: maxAttemptsFromError(row.error_message),
    failed_at: row.completed_at ?? row.started_at,
    error_category: row.error_category,
    error_message: row.error_message,
    connectivity_status: snapshot?.status,
    outage_started_at: snapshot?.last_outage_started_at ?? snapshot?.outage_started_at,
  };
}

export function enqueueCronFailureRecovery(input: EnqueueCronFailureRecoveryInput): RecoveryOutboxRow {
  const payload: CronFailureRecoveryPayload = {
    job_name: input.jobName,
    job_type: input.jobType,
    status: input.status,
    cron_run_id: input.cronRunId,
    task_id: input.taskId,
    incident_id: input.incidentId,
    attempt: input.attempt,
    max_attempts: input.maxAttempts,
    failed_at: toIso(input.failedAt),
    error_category: input.errorCategory,
    error_message: input.errorMessage,
    alert_error: input.alertError,
    connectivity_status: input.connectivityStatus,
    outage_started_at: input.outageStartedAt,
  };
  return enqueueRecoveryOutbox({
    kind: "cron_failure_alert",
    channelId: input.channelId,
    cronRunId: input.cronRunId,
    jobName: input.jobName,
    payload,
    lastError: input.alertError,
  });
}

export function enqueueTaskResultDelivery(input: EnqueueTaskResultDeliveryInput): RecoveryOutboxRow | undefined {
  const messages = input.messages.map((message) => message.trim()).filter(Boolean);
  if (!input.channelId || !messages.length) return undefined;
  const payload: TaskResultDeliveryPayload = {
    task_id: input.taskId,
    job_name: input.jobName,
    route: input.route,
    success: input.success,
    duration_ms: input.durationMs,
    messages,
    created_at: new Date().toISOString(),
    delivery_error: input.deliveryError,
  };
  return enqueueRecoveryOutbox({
    kind: "task_result_delivery",
    channelId: input.channelId,
    taskId: input.taskId,
    jobName: input.jobName,
    payload,
    lastError: input.deliveryError,
  });
}

function outageWindow(snapshot?: ConnectivitySnapshot): { since?: string; until?: string } {
  const since = snapshot?.last_outage_started_at ?? snapshot?.outage_started_at;
  if (!since) return {};
  return {
    since,
    until: snapshot?.updated_at,
  };
}

export function backfillCronMissedAlertsFromOutage(snapshot?: ConnectivitySnapshot, limit = 100): number {
  const window = outageWindow(snapshot);
  if (!window.since) return 0;
  const jobs = new Map(loadCronJobs().jobs.map((job) => [job.name, job]));
  let count = 0;
  for (const row of listCronRunsMissingAlerts({ since: window.since, until: window.until, limit })) {
    const job = jobs.get(row.job_name);
    if (!job?.channel) continue;
    enqueueRecoveryOutbox({
      kind: "cron_failure_alert",
      channelId: job.channel,
      cronRunId: row.id,
      jobName: row.job_name,
      payload: cronPayloadFromRow(row, job.channel, snapshot),
      lastError: row.error_message,
    });
    count++;
  }
  return count;
}

async function fetchSendableChannel(client: Client, channelId: string): Promise<SendableChannels | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && "isSendable" in channel && channel.isSendable()) return channel as SendableChannels;
  } catch (err) {
    log.warn(`fetch channel ${channelId} failed while flushing recovery outbox:`, err);
  }
  return null;
}

function formatCronMissedAlertSummary(rows: RecoveryOutboxRow[]): string {
  const payloads = rows
    .map((row) => parseJsonObject<CronFailureRecoveryPayload>(row))
    .filter((payload): payload is CronFailureRecoveryPayload => Boolean(payload));
  const first = payloads[0];
  const last = payloads[payloads.length - 1];
  const lines = [
    "📬 MiniClaw 补发：网络中断期间错过的定时任务失败通知",
    "",
    `数量: ${rows.length}`,
    ...(first && last ? [`时间范围: ${first.failed_at} → ${last.failed_at}`] : []),
    "",
    "失败任务:",
    ...payloads.slice(0, 12).map((payload) => {
      const attempts = payload.max_attempts ? `${payload.attempt}/${payload.max_attempts}` : String(payload.attempt);
      const task = payload.task_id ? ` task=${shortId(payload.task_id)}` : "";
      const category = payload.error_category ? ` ${payload.error_category}` : "";
      const error = payload.error_message ? ` — ${payload.error_message.slice(0, 180)}` : "";
      return `- ${payload.failed_at} \`${payload.job_name}\` ${payload.status} attempt=${attempts} run=${shortId(payload.cron_run_id)}${task}${category}${error}`;
    }),
  ];
  if (payloads.length > 12) lines.push(`- 另有 ${payloads.length - 12} 条，使用 \`pnpm cron:runs -- --status failed\` 查看`);
  lines.push("", "这些失败在发生时没有成功写入 Discord alert_message_id；本消息是网络恢复后的汇总补发。");
  return lines.join("\n").slice(0, 2000);
}

async function flushCronFailureAlerts(client: Client, rows: RecoveryOutboxRow[]): Promise<{ delivered: number; failed: number }> {
  let delivered = 0;
  let failed = 0;
  const byChannel = new Map<string, RecoveryOutboxRow[]>();
  for (const row of rows) {
    const group = byChannel.get(row.channel_id) ?? [];
    group.push(row);
    byChannel.set(row.channel_id, group);
  }

  for (const [channelId, channelRows] of byChannel) {
    const channel = await fetchSendableChannel(client, channelId);
    if (!channel) {
      for (const row of channelRows) markRecoveryOutboxAttemptFailed(row.id, `channel ${channelId} not sendable`);
      failed += channelRows.length;
      continue;
    }
    try {
      const message = await channel.send(formatCronMissedAlertSummary(channelRows));
      const messageId = "id" in message ? String(message.id) : undefined;
      for (const row of channelRows) {
        markRecoveryOutboxDelivered(row.id, messageId);
        if (row.cron_run_id && messageId) {
          markCronRunAlertDelivered(row.cron_run_id, { messageId, channelId });
        }
      }
      delivered += channelRows.length;
    } catch (err) {
      const msg = sanitizeError(err);
      for (const row of channelRows) markRecoveryOutboxAttemptFailed(row.id, msg);
      failed += channelRows.length;
    }
  }

  return { delivered, failed };
}

async function flushTaskDeliveries(client: Client, rows: RecoveryOutboxRow[]): Promise<{ delivered: number; failed: number }> {
  let delivered = 0;
  let failed = 0;
  for (const row of rows) {
    const payload = parseJsonObject<TaskResultDeliveryPayload>(row);
    if (!payload?.messages?.length) {
      markRecoveryOutboxAttemptFailed(row.id, "invalid task delivery payload");
      failed++;
      continue;
    }
    const channel = await fetchSendableChannel(client, row.channel_id);
    if (!channel) {
      markRecoveryOutboxAttemptFailed(row.id, `channel ${row.channel_id} not sendable`);
      failed++;
      continue;
    }
    try {
      const header = [
        "📬 MiniClaw 补发任务结果",
        "",
        `Task: \`${shortId(payload.task_id)}\``,
        ...(payload.job_name ? [`Cron: \`${payload.job_name}\``] : []),
        `原始状态: ${payload.success ? "success" : "failed"}`,
        `首次投递失败时间: ${payload.created_at}`,
      ].join("\n").slice(0, 2000);
      let sent = await channel.send(header);
      for (const message of payload.messages.slice(0, 20)) {
        sent = await channel.send(message.slice(0, 2000));
      }
      if (payload.messages.length > 20) {
        sent = await channel.send(`... 另有 ${payload.messages.length - 20} 段输出未自动补发，请查看本地 task 记录。`);
      }
      const messageId = "id" in sent ? String(sent.id) : undefined;
      markRecoveryOutboxDelivered(row.id, messageId);
      delivered++;
    } catch (err) {
      markRecoveryOutboxAttemptFailed(row.id, sanitizeError(err));
      failed++;
    }
  }
  return { delivered, failed };
}

export async function flushRecoveryOutbox(
  client: Client,
  options: { snapshot?: ConnectivitySnapshot; limit?: number } = {},
): Promise<FlushRecoveryOutboxResult> {
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)));
  const backfilled = backfillCronMissedAlertsFromOutage(options.snapshot, limit);
  const taskRows = listRecoveryOutbox({ kind: "task_result_delivery", status: "pending", limit });
  const cronRows = listRecoveryOutbox({ kind: "cron_failure_alert", status: "pending", limit });

  const task = await flushTaskDeliveries(client, taskRows);
  const cron = await flushCronFailureAlerts(client, cronRows);
  const result = {
    cronAlertsDelivered: cron.delivered,
    taskDeliveriesDelivered: task.delivered,
    failedAttempts: cron.failed + task.failed,
    backfilledCronAlerts: backfilled,
  };
  if (result.cronAlertsDelivered || result.taskDeliveriesDelivered || result.failedAttempts || result.backfilledCronAlerts) {
    log.info(
      `recovery outbox flush: cron=${result.cronAlertsDelivered} task=${result.taskDeliveriesDelivered} ` +
      `failed=${result.failedAttempts} backfilled=${result.backfilledCronAlerts}`
    );
  }
  return result;
}

export const __testables = {
  formatCronMissedAlertSummary,
  sanitizeError,
};
