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
import { getDb, setDb } from "./connection.js";

export { SCHEMA_VERSION };
export { getDb } from "./connection.js";
export * from "./cron-runs.js";
export * from "./recovery-outbox.js";
export * from "./repositories/chat-history.js";
export * from "./repositories/smart-router-decisions.js";
export * from "./repositories/tasks.js";

export function getSchemaVersion(): number {
  return getDatabaseSchemaVersion(getDb());
}

export function listSchemaVersionHistory(): SchemaVersionHistoryRow[] {
  return listDatabaseSchemaVersionHistory(getDb());
}

export function initDb(): void {
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const database = new Database(config.dbPath);
  setDb(database);
  database.pragma("journal_mode = WAL");
  ensureBaseSchema(database);
  runDatabaseMigrations(database);
}

export const __testables = {
  columnExists: (table: string, column: string) => schemaColumnExists(getDb(), table, column),
  runMigrations: () => runDatabaseMigrations(getDb()),
};

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
  getDb().prepare(
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
  getDb().prepare(`UPDATE scenes SET ${fields.join(", ")} WHERE id = @id`).run(params);
}

export function getScene(id: string): SceneRow | undefined {
  return getDb().prepare("SELECT * FROM scenes WHERE id = ?").get(id) as SceneRow | undefined;
}

export function getSceneByName(name: string): SceneRow | undefined {
  return getDb().prepare("SELECT * FROM scenes WHERE name = ? ORDER BY started_at DESC LIMIT 1").get(name) as SceneRow | undefined;
}

export function listRecentScenes(limit = 20): SceneRow[] {
  return getDb().prepare("SELECT * FROM scenes ORDER BY started_at DESC LIMIT ?").all(limit) as SceneRow[];
}

export function appendSceneMessage(msg: {
  scene_id: string;
  ts: string;
  speaker: string;
  content?: string;
  tool_calls_json?: string;
  cost_usd?: number;
}): void {
  getDb().prepare(
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
  return getDb()
    .prepare("SELECT * FROM scene_messages WHERE scene_id = ? ORDER BY id ASC")
    .all(sceneId) as SceneMessageRow[];
}
