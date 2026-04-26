import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { config } from "../config.js";

let db: Database.Database;

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
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_channel_id TEXT NOT NULL,
      discord_user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
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
    Pick<TaskRow, "session_id" | "status" | "result_summary" | "cost_usd" | "duration_ms" | "completed_at">
  >
): void {
  const sets = Object.keys(updates)
    .map((k) => `${k} = @${k}`)
    .join(", ");
  db.prepare(`UPDATE tasks SET ${sets} WHERE id = @id`).run({ id, ...updates });
}

export function getTask(id: string): TaskRow | undefined {
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
}

export function getActiveTasks(): TaskRow[] {
  return db.prepare("SELECT * FROM tasks WHERE status = 'running' ORDER BY created_at DESC").all() as TaskRow[];
}

export function getRecentTasks(limit = 10): TaskRow[] {
  return db.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?").all(limit) as TaskRow[];
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
