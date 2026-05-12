import { getDb } from "../connection.js";
import { recordSmartRouterTaskOutcome } from "./smart-router-decisions.js";

export const TASK_STATUSES = [
  "queued",
  "running",
  "interrupted",
  "completed",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

const ALLOWED_UPDATE_FIELDS = new Set([
  "session_id",
  "status",
  "result_summary",
  "cost_usd",
  "duration_ms",
  "completed_at",
  "progress_message_id",
]);

export interface TaskRow {
  id: string;
  discord_thread_id: string | null;
  discord_user_id: string;
  prompt: string;
  cwd: string | null;
  session_id: string | null;
  status: string;
  result_summary: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
  progress_message_id: string | null;
  source_route_type: string | null;
  source_channel_id: string | null;
  source_message_id: string | null;
  source_message_url: string | null;
  source_metadata_json: string | null;
  parent_context_json: string | null;
}

export function createTask(task: {
  id: string;
  discord_thread_id: string;
  discord_user_id: string;
  prompt: string;
  cwd: string;
  source_route_type?: string;
  source_channel_id?: string;
  source_message_id?: string;
  source_message_url?: string;
  source_metadata_json?: string;
  parent_context_json?: string;
}): void {
  const row = {
    ...task,
    source_route_type: task.source_route_type ?? null,
    source_channel_id: task.source_channel_id ?? null,
    source_message_id: task.source_message_id ?? null,
    source_message_url: task.source_message_url ?? null,
    source_metadata_json: task.source_metadata_json ?? null,
    parent_context_json: task.parent_context_json ?? null,
  };
  getDb()
    .prepare(
      `INSERT INTO tasks (
         id, discord_thread_id, discord_user_id, prompt, cwd,
         source_route_type, source_channel_id, source_message_id, source_message_url,
         source_metadata_json, parent_context_json
       )
       VALUES (
         @id, @discord_thread_id, @discord_user_id, @prompt, @cwd,
         @source_route_type, @source_channel_id, @source_message_id, @source_message_url,
         @source_metadata_json, @parent_context_json
       )`
    )
    .run(row);
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<TaskRow, "session_id" | "status" | "result_summary" | "cost_usd" | "duration_ms" | "completed_at" | "progress_message_id">
  >
): void {
  const safeKeys = Object.keys(updates).filter((key) => ALLOWED_UPDATE_FIELDS.has(key));
  if (!safeKeys.length) return;
  const sets = safeKeys.map((key) => `${key} = @${key}`).join(", ");
  const params: Record<string, unknown> = { id };
  for (const key of safeKeys) {
    params[key] = (updates as Record<string, unknown>)[key];
  }
  const result = getDb().prepare(`UPDATE tasks SET ${sets} WHERE id = @id`).run(params);
  if (result.changes > 0 && typeof updates.status === "string") {
    recordSmartRouterTaskOutcome(id, updates.status);
  }
}

function assertTaskRows(rows: unknown[]): TaskRow[] {
  for (const row of rows) {
    if (!row || typeof row !== "object" || !("id" in row) || !("status" in row)) {
      throw new Error("Unexpected task row shape from database");
    }
  }
  return rows as TaskRow[];
}

export function getTask(id: string): TaskRow | undefined {
  const row = getDb().prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  if (!row) return undefined;
  return assertTaskRows([row])[0];
}

export function getTaskByThreadId(threadId: string): TaskRow | undefined {
  const row = getDb()
    .prepare(
      `SELECT * FROM tasks
       WHERE discord_thread_id = ? AND session_id IS NOT NULL
       ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .get(threadId);
  if (!row) return undefined;
  return assertTaskRows([row])[0];
}

export function getActiveTasks(): TaskRow[] {
  return assertTaskRows(getDb().prepare("SELECT * FROM tasks WHERE status = 'running' ORDER BY created_at DESC").all());
}

export function getInterruptedTasks(limit = 5): TaskRow[] {
  return assertTaskRows(
    getDb().prepare("SELECT * FROM tasks WHERE status = 'interrupted' ORDER BY completed_at DESC LIMIT ?").all(limit)
  );
}

export function markTaskInterrupted(id: string, resultSummary?: string): void {
  const result = getDb()
    .prepare(
      `UPDATE tasks
       SET status = 'interrupted',
           result_summary = COALESCE(@result_summary, result_summary),
           completed_at = datetime('now')
       WHERE id = @id AND status = 'running'`
    )
    .run({ id, result_summary: resultSummary ?? null });
  if (result.changes > 0) recordSmartRouterTaskOutcome(id, "interrupted");
}

export function getRecentTasks(limit = 10): TaskRow[] {
  return assertTaskRows(getDb().prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?").all(limit));
}
