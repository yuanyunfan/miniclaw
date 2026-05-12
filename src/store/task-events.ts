import { getDb } from "./connection.js";

export type TaskEventSeverity = "debug" | "info" | "warning" | "error";

export interface TaskEventRow {
  id: number;
  task_id: string;
  event_type: string;
  severity: TaskEventSeverity;
  message: string | null;
  payload_json: string | null;
  created_at: string;
}

export interface TaskEventInput {
  taskId: string;
  eventType: string;
  severity?: TaskEventSeverity;
  message?: string;
  payload?: unknown;
}

function json(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(value);
}

export function appendTaskEvent(input: TaskEventInput): number {
  const result = getDb().prepare(
    `INSERT INTO task_events (task_id, event_type, severity, message, payload_json)
     VALUES (@task_id, @event_type, @severity, @message, @payload_json)`
  ).run({
    task_id: input.taskId,
    event_type: input.eventType,
    severity: input.severity ?? "info",
    message: input.message ?? null,
    payload_json: json(input.payload),
  });
  return Number(result.lastInsertRowid);
}

export function listTaskEvents(taskId: string, limit = 50): TaskEventRow[] {
  return getDb()
    .prepare("SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(taskId, limit) as TaskEventRow[];
}

export function countTaskEvents(taskId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM task_events WHERE task_id = ?")
    .get(taskId) as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}
