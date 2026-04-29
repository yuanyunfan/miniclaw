import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { config } from "../config.js";

let db: Database.Database;

export function getDb(): Database.Database {
  return db;
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      discord_thread_id TEXT,
      discord_user_id TEXT,
      prompt TEXT NOT NULL,
      cwd TEXT,
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      result_summary TEXT,
      cost_usd REAL,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      progress_message_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'user',
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_channel_id TEXT NOT NULL,
      discord_user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      name TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      mode TEXT NOT NULL,
      total_cost_usd REAL DEFAULT 0,
      total_turns INTEGER DEFAULT 0,
      transcript_path TEXT
    );
    CREATE TABLE IF NOT EXISTS scene_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scene_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      speaker TEXT NOT NULL,
      content TEXT,
      tool_calls_json TEXT,
      cost_usd REAL,
      FOREIGN KEY (scene_id) REFERENCES scenes(id)
    );
    CREATE INDEX IF NOT EXISTS idx_scene_msgs_scene ON scene_messages(scene_id);
  `);

  // Idempotent migration for existing DBs that predate progress_message_id.
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN progress_message_id TEXT`);
  } catch {
    // column already exists — ignore
  }
}

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
}

export function createTask(task: {
  id: string;
  discord_thread_id: string;
  discord_user_id: string;
  prompt: string;
  cwd: string;
}): void {
  db.prepare(
    `INSERT INTO tasks (id, discord_thread_id, discord_user_id, prompt, cwd)
     VALUES (@id, @discord_thread_id, @discord_user_id, @prompt, @cwd)`
  ).run(task);
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
  db.prepare(`UPDATE tasks SET ${sets} WHERE id = @id`).run(params);
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
     ORDER BY created_at DESC LIMIT 1`
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

export function markTaskInterrupted(id: string): void {
  db.prepare(
    `UPDATE tasks SET status = 'interrupted', completed_at = datetime('now')
     WHERE id = ? AND status = 'running'`
  ).run(id);
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
