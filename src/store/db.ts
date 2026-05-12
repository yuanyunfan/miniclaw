import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { config } from "../config.js";
import {
  SCHEMA_VERSION,
  columnExists as schemaColumnExists,
  ensureBaseSchema,
  getSchemaVersion as getDatabaseSchemaVersion,
  listSchemaVersionHistory as listDatabaseSchemaVersionHistory,
  runMigrations as runDatabaseMigrations,
} from "./schema.js";
import type { SchemaVersionHistoryRow } from "./schema.js";

let db: Database.Database;
export { SCHEMA_VERSION };

export function getDb(): Database.Database {
  return db;
}

export function getSchemaVersion(): number {
  return getDatabaseSchemaVersion(db);
}

export function listSchemaVersionHistory(): SchemaVersionHistoryRow[] {
  return listDatabaseSchemaVersionHistory(db);
}

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
  "session_id", "status", "result_summary", "cost_usd", "duration_ms", "completed_at", "progress_message_id",
]);

export function initDb(): void {
  mkdirSync(dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  ensureBaseSchema(db);
  runDatabaseMigrations(db);
}

export const __testables = {
  columnExists: (table: string, column: string) => schemaColumnExists(db, table, column),
  runMigrations: () => runDatabaseMigrations(db),
};

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
  db.prepare(
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
  ).run(row);
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<TaskRow, "session_id" | "status" | "result_summary" | "cost_usd" | "duration_ms" | "completed_at" | "progress_message_id">
  >
): void {
  const safeKeys = Object.keys(updates).filter((k) => ALLOWED_UPDATE_FIELDS.has(k));
  if (!safeKeys.length) return;
  const sets = safeKeys.map((k) => `${k} = @${k}`).join(", ");
  const params: Record<string, unknown> = { id };
  for (const k of safeKeys) params[k] = (updates as Record<string, unknown>)[k];
  const result = db.prepare(`UPDATE tasks SET ${sets} WHERE id = @id`).run(params);
  if (result.changes > 0 && typeof updates.status === "string") {
    recordSmartRouterTaskOutcome(id, updates.status);
  }
}

function assertTaskRows(rows: unknown[]): TaskRow[] {
  for (const r of rows) {
    if (!r || typeof r !== "object" || !("id" in r) || !("status" in r)) {
      throw new Error("Unexpected task row shape from database");
    }
  }
  return rows as TaskRow[];
}

export function getTask(id: string): TaskRow | undefined {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  if (!row) return undefined;
  return assertTaskRows([row])[0];
}

export function getTaskByThreadId(threadId: string): TaskRow | undefined {
  const row = db.prepare(
    `SELECT * FROM tasks
     WHERE discord_thread_id = ? AND session_id IS NOT NULL
     ORDER BY created_at DESC, rowid DESC LIMIT 1`
  ).get(threadId);
  if (!row) return undefined;
  return assertTaskRows([row])[0];
}

export function getActiveTasks(): TaskRow[] {
  return assertTaskRows(db.prepare("SELECT * FROM tasks WHERE status = 'running' ORDER BY created_at DESC").all());
}

export function getInterruptedTasks(limit = 5): TaskRow[] {
  return assertTaskRows(
    db.prepare("SELECT * FROM tasks WHERE status = 'interrupted' ORDER BY completed_at DESC LIMIT ?").all(limit)
  );
}

export function markTaskInterrupted(id: string, resultSummary?: string): void {
  const result = db.prepare(
    `UPDATE tasks
     SET status = 'interrupted',
         result_summary = COALESCE(@result_summary, result_summary),
         completed_at = datetime('now')
     WHERE id = @id AND status = 'running'`
  ).run({ id, result_summary: resultSummary ?? null });
  if (result.changes > 0) recordSmartRouterTaskOutcome(id, "interrupted");
}

export function getRecentTasks(limit = 10): TaskRow[] {
  return assertTaskRows(db.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?").all(limit));
}

export function addChatMessage(channelId: string, userId: string, role: string, content: string): void {
  db.prepare(
    `INSERT INTO chat_history (discord_channel_id, discord_user_id, role, content) VALUES (?, ?, ?, ?)`
  ).run(channelId, userId, role, content);
}

export function getChatHistory(
  channelId: string,
  limit = 20
): Array<{ role: string; content: string }> {
  return db
    .prepare(
      `SELECT role, content FROM chat_history
       WHERE discord_channel_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(channelId, limit) as Array<{ role: string; content: string }>;
}

export interface SmartRouterDecisionRow {
  id: number;
  message_id: string;
  channel_id: string;
  user_id: string;
  prompt_hash: string;
  prompt_preview: string | null;
  full_prompt: string | null;
  intent: string;
  confidence: number;
  reason: string | null;
  matched_signals: string;
  risk_flags: string;
  capabilities_json: string | null;
  classifier_elapsed_ms: number | null;
  classifier_error_type: string | null;
  classifier_error_message: string | null;
  action_result: string | null;
  created_task_id: string | null;
  user_choice: string | null;
  final_route: string | null;
  task_final_status: string | null;
  correction_type: string | null;
  correction_note: string | null;
  resolved_at: string | null;
  created_at: string;
}

export type SmartRouterUserChoice =
  | "accepted_task"
  | "continued_chat"
  | "cancelled"
  | "ignored"
  | "auto_task_no_choice";
export type SmartRouterFinalRoute = "chat" | "task" | "none";
export type SmartRouterTaskFinalStatus = "completed" | "failed" | "cancelled" | "interrupted" | "not_created";
export type SmartRouterCorrectionType =
  | "false_positive"
  | "false_negative"
  | "classifier_error"
  | "policy_blocked"
  | "user_override"
  | "none";

export interface SmartRouterReviewRow extends SmartRouterDecisionRow {
  linked_task_status: string | null;
}

export function recordSmartRouterDecision(row: {
  message_id: string;
  channel_id: string;
  user_id: string;
  prompt_hash: string;
  prompt_preview?: string;
  full_prompt?: string;
  intent: string;
  confidence: number;
  reason?: string;
  matched_signals?: string[];
  risk_flags?: string[];
  capabilities_json?: string;
  classifier_elapsed_ms?: number;
  classifier_error_type?: string;
  classifier_error_message?: string;
  action_result?: string;
  created_task_id?: string;
  user_choice?: SmartRouterUserChoice;
  final_route?: SmartRouterFinalRoute;
  task_final_status?: SmartRouterTaskFinalStatus;
  correction_type?: SmartRouterCorrectionType;
  correction_note?: string;
  resolved_at?: string;
}): number {
  const result = db.prepare(
    `INSERT INTO smart_router_decisions (
      message_id, channel_id, user_id, prompt_hash, prompt_preview, full_prompt,
      intent, confidence, reason, matched_signals, risk_flags, capabilities_json,
      classifier_elapsed_ms, classifier_error_type, classifier_error_message,
      action_result, created_task_id, user_choice, final_route, task_final_status,
      correction_type, correction_note, resolved_at
    ) VALUES (
      @message_id, @channel_id, @user_id, @prompt_hash, @prompt_preview, @full_prompt,
      @intent, @confidence, @reason, @matched_signals, @risk_flags, @capabilities_json,
      @classifier_elapsed_ms, @classifier_error_type, @classifier_error_message,
      @action_result, @created_task_id, @user_choice, @final_route, @task_final_status,
      @correction_type, @correction_note, @resolved_at
    )`
  ).run({
    message_id: row.message_id,
    channel_id: row.channel_id,
    user_id: row.user_id,
    prompt_hash: row.prompt_hash,
    prompt_preview: row.prompt_preview ?? null,
    full_prompt: row.full_prompt ?? null,
    intent: row.intent,
    confidence: row.confidence,
    reason: row.reason ?? null,
    matched_signals: JSON.stringify(row.matched_signals ?? []),
    risk_flags: JSON.stringify(row.risk_flags ?? []),
    capabilities_json: row.capabilities_json ?? null,
    classifier_elapsed_ms: row.classifier_elapsed_ms ?? null,
    classifier_error_type: row.classifier_error_type ?? null,
    classifier_error_message: row.classifier_error_message ?? null,
    action_result: row.action_result ?? null,
    created_task_id: row.created_task_id ?? null,
    user_choice: row.user_choice ?? null,
    final_route: row.final_route ?? null,
    task_final_status: row.task_final_status ?? null,
    correction_type: row.correction_type ?? null,
    correction_note: row.correction_note ?? null,
    resolved_at: row.resolved_at ?? null,
  });
  return Number(result.lastInsertRowid);
}

export interface SmartRouterDecisionUpdate {
  action_result?: string | null;
  created_task_id?: string | null;
  user_choice?: SmartRouterUserChoice | null;
  final_route?: SmartRouterFinalRoute | null;
  task_final_status?: SmartRouterTaskFinalStatus | null;
  correction_type?: SmartRouterCorrectionType | null;
  correction_note?: string | null;
  resolved_at?: string | null;
}

export function updateSmartRouterDecision(
  id: number,
  updates: SmartRouterDecisionUpdate
): void {
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };
  for (const key of [
    "action_result",
    "created_task_id",
    "user_choice",
    "final_route",
    "task_final_status",
    "correction_type",
    "correction_note",
    "resolved_at",
  ] as const) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = @${key}`);
      params[key] = updates[key];
    }
  }
  if (!fields.length) return;
  db.prepare(`UPDATE smart_router_decisions SET ${fields.join(", ")} WHERE id = @id`).run(params);
}

function resolvedAtNow(): string {
  return new Date().toISOString();
}

function normalizeTaskFinalStatus(status: string): SmartRouterTaskFinalStatus | undefined {
  if (status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted") {
    return status;
  }
  return undefined;
}

export function recordSmartRouterUserChoice(
  id: number,
  choice: SmartRouterUserChoice,
  finalRoute: SmartRouterFinalRoute,
  updates: Omit<SmartRouterDecisionUpdate, "user_choice" | "final_route"> = {}
): void {
  const terminal = finalRoute !== "task" || updates.task_final_status !== undefined;
  updateSmartRouterDecision(id, {
    user_choice: choice,
    final_route: finalRoute,
    correction_type: "none",
    ...updates,
    ...(terminal && updates.resolved_at === undefined ? { resolved_at: resolvedAtNow() } : {}),
  });
}

export function recordSmartRouterTaskOutcome(taskId: string, status: string): number {
  const taskFinalStatus = normalizeTaskFinalStatus(status);
  if (!taskFinalStatus) return 0;
  const result = db.prepare(
    `UPDATE smart_router_decisions
     SET task_final_status = @task_final_status,
         final_route = COALESCE(final_route, 'task'),
         correction_type = COALESCE(correction_type, 'none'),
         resolved_at = @resolved_at
     WHERE created_task_id = @task_id`
  ).run({
    task_id: taskId,
    task_final_status: taskFinalStatus,
    resolved_at: resolvedAtNow(),
  });
  return Number(result.changes ?? 0);
}

export function getRecentSmartRouterDecisions(limit = 20): SmartRouterDecisionRow[] {
  return db
    .prepare("SELECT * FROM smart_router_decisions ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(limit) as SmartRouterDecisionRow[];
}

export function listSmartRouterReviewRows(options: {
  since?: string;
  until?: string;
  channelId?: string;
  limit?: number;
} = {}): SmartRouterReviewRow[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {
    limit: Math.max(1, Math.min(options.limit ?? 200, 1000)),
  };
  if (options.since) {
    where.push("d.created_at >= @since");
    params.since = options.since;
  }
  if (options.until) {
    where.push("d.created_at <= @until");
    params.until = options.until;
  }
  if (options.channelId) {
    where.push("d.channel_id = @channel_id");
    params.channel_id = options.channelId;
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return db.prepare(
    `SELECT d.*, t.status AS linked_task_status
     FROM smart_router_decisions d
     LEFT JOIN tasks t ON t.id = d.created_task_id
     ${whereSql}
     ORDER BY d.created_at DESC, d.id DESC
     LIMIT @limit`
  ).all(params) as SmartRouterReviewRow[];
}

// ===== Stage 子系统：scenes / scene_messages =====

export interface SceneRow {
  id: string;
  name: string | null;
  started_at: string;
  ended_at: string | null;
  mode: string;
  total_cost_usd: number | null;
  total_turns: number | null;
  transcript_path: string | null;
}

export interface SceneMessageRow {
  id: number;
  scene_id: string;
  ts: string;
  speaker: string;
  content: string | null;
  tool_calls_json: string | null;
  cost_usd: number | null;
}

export function createScene(scene: {
  id: string;
  name?: string;
  mode: string;
  transcript_path?: string;
}): void {
  db.prepare(
    `INSERT INTO scenes (id, name, started_at, mode, transcript_path)
     VALUES (@id, @name, datetime('now'), @mode, @transcript_path)`
  ).run({
    id: scene.id,
    name: scene.name ?? null,
    mode: scene.mode,
    transcript_path: scene.transcript_path ?? null,
  });
}

export function updateSceneTotals(
  id: string,
  updates: { total_cost_usd?: number; total_turns?: number; ended_at?: string | null; name?: string | null }
): void {
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };
  for (const k of ["total_cost_usd", "total_turns", "ended_at", "name"] as const) {
    if (k in updates) {
      fields.push(`${k} = @${k}`);
      params[k] = updates[k] ?? null;
    }
  }
  if (!fields.length) return;
  db.prepare(`UPDATE scenes SET ${fields.join(", ")} WHERE id = @id`).run(params);
}

export function getScene(id: string): SceneRow | undefined {
  return db.prepare("SELECT * FROM scenes WHERE id = ?").get(id) as SceneRow | undefined;
}

export function getSceneByName(name: string): SceneRow | undefined {
  return db.prepare("SELECT * FROM scenes WHERE name = ? ORDER BY started_at DESC LIMIT 1").get(name) as SceneRow | undefined;
}

export function listRecentScenes(limit = 20): SceneRow[] {
  return db.prepare("SELECT * FROM scenes ORDER BY started_at DESC LIMIT ?").all(limit) as SceneRow[];
}

export function appendSceneMessage(msg: {
  scene_id: string;
  ts: string;
  speaker: string;
  content?: string;
  tool_calls_json?: string;
  cost_usd?: number;
}): void {
  db.prepare(
    `INSERT INTO scene_messages (scene_id, ts, speaker, content, tool_calls_json, cost_usd)
     VALUES (@scene_id, @ts, @speaker, @content, @tool_calls_json, @cost_usd)`
  ).run({
    scene_id: msg.scene_id,
    ts: msg.ts,
    speaker: msg.speaker,
    content: msg.content ?? null,
    tool_calls_json: msg.tool_calls_json ?? null,
    cost_usd: msg.cost_usd ?? null,
  });
}

export function getSceneMessages(sceneId: string): SceneMessageRow[] {
  return db
    .prepare("SELECT * FROM scene_messages WHERE scene_id = ? ORDER BY id ASC")
    .all(sceneId) as SceneMessageRow[];
}
