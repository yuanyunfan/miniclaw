import { v4 as uuid } from "uuid";
import { getDb } from "./connection.js";

export type TaskControlEventType =
  | "operator_message"
  | "cancel"
  | "pause_after_turn"
  | "approve_tool"
  | "deny_tool"
  | "set_mode";

export type TaskControlEventStatus = "queued" | "consumed" | "cancelled";

export interface TaskControlEventRow {
  id: string;
  task_id: string;
  event_type: TaskControlEventType;
  status: TaskControlEventStatus;
  payload_json: string;
  discord_message_id: string | null;
  actor_id: string | null;
  created_at: string;
  consumed_at: string | null;
}

function iso(date = new Date()): string {
  return date.toISOString();
}

function assertTaskControlEventRow(row: unknown): TaskControlEventRow {
  if (!row || typeof row !== "object") {
    throw new Error("Unexpected task_control_events row shape");
  }
  return row as TaskControlEventRow;
}

export function appendTaskControlEvent(params: {
  taskId: string;
  eventType: TaskControlEventType;
  payload: unknown;
  discordMessageId?: string;
  actorId?: string;
  now?: Date;
}): TaskControlEventRow {
  const id = uuid();
  getDb().prepare(
    `INSERT INTO task_control_events (
       id, task_id, event_type, status, payload_json, discord_message_id, actor_id, created_at, consumed_at
     ) VALUES (
       @id, @task_id, @event_type, 'queued', @payload_json, @discord_message_id, @actor_id, @created_at, NULL
     )`
  ).run({
    id,
    task_id: params.taskId,
    event_type: params.eventType,
    payload_json: JSON.stringify(params.payload),
    discord_message_id: params.discordMessageId ?? null,
    actor_id: params.actorId ?? null,
    created_at: iso(params.now),
  });
  const row = getDb().prepare("SELECT * FROM task_control_events WHERE id = ?").get(id);
  return assertTaskControlEventRow(row);
}

export function listQueuedTaskControlEvents(taskId: string, limit = 50): TaskControlEventRow[] {
  return getDb().prepare(
    `SELECT * FROM task_control_events
     WHERE task_id = ? AND status = 'queued'
     ORDER BY datetime(created_at) ASC, rowid ASC
     LIMIT ?`
  ).all(taskId, Math.min(Math.max(limit, 1), 200)).map(assertTaskControlEventRow);
}

export function markTaskControlEventsConsumed(ids: string[], now = new Date()): number {
  if (!ids.length) return 0;
  const stmt = getDb().prepare(
    `UPDATE task_control_events
     SET status = 'consumed',
         consumed_at = @consumed_at
     WHERE id = @id AND status = 'queued'`
  );
  const run = getDb().transaction((eventIds: string[]) => {
    let changed = 0;
    for (const id of eventIds) {
      changed += stmt.run({ id, consumed_at: iso(now) }).changes;
    }
    return changed;
  });
  return run(ids);
}
