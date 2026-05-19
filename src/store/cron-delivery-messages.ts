import { randomUUID } from "node:crypto";
import { getDb } from "./connection.js";

export interface CronDeliveryMessageGroupRow {
  id: string;
  job_name: string;
  channel_id: string;
  delivery_key: string;
  delivery_mode: string;
  task_id: string | null;
  message_ids_json: string;
  created_at: string;
  updated_at: string;
}

export interface CronDeliveryMessageGroup {
  id: string;
  jobName: string;
  channelId: string;
  deliveryKey: string;
  deliveryMode: string;
  taskId?: string;
  messageIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpsertCronDeliveryMessageGroupInput {
  jobName: string;
  channelId: string;
  deliveryKey: string;
  deliveryMode: string;
  taskId?: string;
  messageIds: string[];
}

function assertRow(row: unknown): CronDeliveryMessageGroupRow {
  if (!row || typeof row !== "object" || !("id" in row) || !("message_ids_json" in row)) {
    throw new Error("Unexpected cron delivery message row shape from database");
  }
  return row as CronDeliveryMessageGroupRow;
}

function parseMessageIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function toGroup(row: CronDeliveryMessageGroupRow): CronDeliveryMessageGroup {
  return {
    id: row.id,
    jobName: row.job_name,
    channelId: row.channel_id,
    deliveryKey: row.delivery_key,
    deliveryMode: row.delivery_mode,
    ...(row.task_id ? { taskId: row.task_id } : {}),
    messageIds: parseMessageIds(row.message_ids_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getCronDeliveryMessageGroup(input: {
  jobName: string;
  channelId: string;
  deliveryKey: string;
  deliveryMode: string;
}): CronDeliveryMessageGroup | undefined {
  const row = getDb().prepare(
    `SELECT * FROM cron_delivery_messages
     WHERE job_name = @job_name
       AND channel_id = @channel_id
       AND delivery_key = @delivery_key
       AND delivery_mode = @delivery_mode`
  ).get({
    job_name: input.jobName,
    channel_id: input.channelId,
    delivery_key: input.deliveryKey,
    delivery_mode: input.deliveryMode,
  });
  return row ? toGroup(assertRow(row)) : undefined;
}

export function upsertCronDeliveryMessageGroup(
  input: UpsertCronDeliveryMessageGroupInput,
): CronDeliveryMessageGroup {
  const id = randomUUID();
  const params = {
    id,
    job_name: input.jobName,
    channel_id: input.channelId,
    delivery_key: input.deliveryKey,
    delivery_mode: input.deliveryMode,
    task_id: input.taskId ?? null,
    message_ids_json: JSON.stringify(input.messageIds),
  };
  getDb().prepare(
    `INSERT INTO cron_delivery_messages (
      id, job_name, channel_id, delivery_key, delivery_mode, task_id, message_ids_json
    ) VALUES (
      @id, @job_name, @channel_id, @delivery_key, @delivery_mode, @task_id, @message_ids_json
    )
    ON CONFLICT(job_name, channel_id, delivery_key, delivery_mode) DO UPDATE SET
      task_id = COALESCE(excluded.task_id, task_id),
      message_ids_json = excluded.message_ids_json,
      updated_at = datetime('now')`
  ).run(params);
  const current = getCronDeliveryMessageGroup({
    jobName: input.jobName,
    channelId: input.channelId,
    deliveryKey: input.deliveryKey,
    deliveryMode: input.deliveryMode,
  });
  if (!current) throw new Error("cron delivery message group upsert failed");
  return current;
}
