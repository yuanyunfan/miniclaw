import { randomUUID } from "node:crypto";
import { getDb } from "./connection.js";

export const RECOVERY_OUTBOX_KINDS = [
  "cron_failure_alert",
  "task_result_delivery",
  "pre_provider_attachment_delivery",
] as const;

export const RECOVERY_OUTBOX_STATUSES = [
  "pending",
  "delivered",
  "failed",
] as const;

export type RecoveryOutboxKind = typeof RECOVERY_OUTBOX_KINDS[number];
export type RecoveryOutboxStatus = typeof RECOVERY_OUTBOX_STATUSES[number];

export interface RecoveryOutboxRow {
  id: string;
  kind: RecoveryOutboxKind;
  status: RecoveryOutboxStatus;
  channel_id: string;
  cron_run_id: string | null;
  task_id: string | null;
  job_name: string | null;
  payload_json: string;
  attempts: number;
  last_error: string | null;
  message_id: string | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
}

export interface EnqueueRecoveryOutboxInput {
  id?: string;
  kind: RecoveryOutboxKind;
  channelId: string;
  cronRunId?: string | null;
  taskId?: string | null;
  jobName?: string | null;
  payload: unknown;
  lastError?: string | null;
}

export interface ListRecoveryOutboxOptions {
  kind?: RecoveryOutboxKind;
  status?: RecoveryOutboxStatus;
  limit?: number;
}

function assertRecoveryOutboxRow(row: unknown): RecoveryOutboxRow {
  if (!row || typeof row !== "object" || !("id" in row) || !("kind" in row)) {
    throw new Error("Unexpected recovery outbox row shape from database");
  }
  return row as RecoveryOutboxRow;
}

function normalizeLimit(limit: number | undefined, fallback: number, max: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(limit)));
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

export function enqueueRecoveryOutbox(input: EnqueueRecoveryOutboxInput): RecoveryOutboxRow {
  const id = input.id ?? randomUUID();
  const params = {
    id,
    kind: input.kind,
    channel_id: input.channelId,
    cron_run_id: input.cronRunId ?? null,
    task_id: input.taskId ?? null,
    job_name: input.jobName ?? null,
    payload_json: json(input.payload),
    last_error: input.lastError ?? null,
  };
  const result = getDb().prepare(
    `INSERT OR IGNORE INTO recovery_outbox (
      id, kind, status, channel_id, cron_run_id, task_id, job_name, payload_json, last_error
    ) VALUES (
      @id, @kind, 'pending', @channel_id, @cron_run_id, @task_id, @job_name, @payload_json, @last_error
    )`
  ).run(params);

  if (result.changes === 0) {
    getDb().prepare(
      `UPDATE recovery_outbox SET
        status = 'pending',
        channel_id = @channel_id,
        job_name = COALESCE(@job_name, job_name),
        payload_json = @payload_json,
        last_error = COALESCE(@last_error, last_error),
        updated_at = datetime('now')
       WHERE kind = @kind
         AND (
           (@cron_run_id IS NOT NULL AND cron_run_id = @cron_run_id)
           OR (@task_id IS NOT NULL AND task_id = @task_id)
           OR id = @id
         )`
    ).run(params);
  }

  if (input.cronRunId) {
    const row = getDb().prepare(
      "SELECT * FROM recovery_outbox WHERE kind = @kind AND cron_run_id = @cron_run_id"
    ).get(params);
    return assertRecoveryOutboxRow(row);
  }
  if (input.taskId) {
    const row = getDb().prepare(
      "SELECT * FROM recovery_outbox WHERE kind = @kind AND task_id = @task_id"
    ).get(params);
    return assertRecoveryOutboxRow(row);
  }
  return getRecoveryOutboxRow(id)!;
}

export function getRecoveryOutboxRow(id: string): RecoveryOutboxRow | undefined {
  const row = getDb().prepare("SELECT * FROM recovery_outbox WHERE id = ?").get(id);
  return row ? assertRecoveryOutboxRow(row) : undefined;
}

export function listRecoveryOutbox(options: ListRecoveryOutboxOptions = {}): RecoveryOutboxRow[] {
  const filters: string[] = [];
  const params: Record<string, unknown> = {};
  if (options.kind) {
    filters.push("kind = @kind");
    params.kind = options.kind;
  }
  if (options.status) {
    filters.push("status = @status");
    params.status = options.status;
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  return getDb().prepare(
    `SELECT * FROM recovery_outbox
     ${where}
     ORDER BY datetime(created_at) ASC, id ASC
     LIMIT @limit`
  ).all({
    ...params,
    limit: normalizeLimit(options.limit, 50, 500),
  }).map(assertRecoveryOutboxRow);
}

export function markRecoveryOutboxDelivered(id: string, messageId?: string | null, deliveredAt = new Date()): RecoveryOutboxRow | undefined {
  getDb().prepare(
    `UPDATE recovery_outbox SET
      status = 'delivered',
      message_id = COALESCE(@message_id, message_id),
      delivered_at = @delivered_at,
      updated_at = datetime('now')
     WHERE id = @id`
  ).run({
    id,
    message_id: messageId ?? null,
    delivered_at: deliveredAt.toISOString(),
  });
  return getRecoveryOutboxRow(id);
}

export function markRecoveryOutboxAttemptFailed(id: string, error: string): RecoveryOutboxRow | undefined {
  getDb().prepare(
    `UPDATE recovery_outbox SET
      status = 'pending',
      attempts = attempts + 1,
      last_error = @last_error,
      updated_at = datetime('now')
     WHERE id = @id`
  ).run({
    id,
    last_error: error.slice(0, 1500),
  });
  return getRecoveryOutboxRow(id);
}
