import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  __testables,
  columnExists,
  ensureBaseSchema,
  getSchemaVersion,
  listSchemaVersionHistory,
  runMigrations,
} from "../schema.js";
import type { SchemaMigration } from "../migrations/types.js";

function withMemoryDb(fn: (db: Database.Database) => void): void {
  const db = new Database(":memory:");
  try {
    fn(db);
  } finally {
    db.close();
  }
}

function createLegacyV4RouterSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE tasks (
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
      progress_message_id TEXT,
      source_route_type TEXT,
      source_channel_id TEXT,
      source_message_id TEXT,
      source_message_url TEXT,
      source_metadata_json TEXT,
      parent_context_json TEXT
    );
    CREATE TABLE smart_router_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      prompt_preview TEXT,
      full_prompt TEXT,
      intent TEXT NOT NULL,
      confidence REAL NOT NULL,
      reason TEXT,
      matched_signals TEXT NOT NULL DEFAULT '[]',
      risk_flags TEXT NOT NULL DEFAULT '[]',
      action_result TEXT,
      created_task_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    PRAGMA user_version = 4;
  `);
}

describe("store schema migrations", () => {
  it("applies all migrations from a newly initialized database and records audit history", () => {
    withMemoryDb((db) => {
      ensureBaseSchema(db);
      runMigrations(db);

      expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
      expect(columnExists(db, "schema_version_history", "migration_name")).toBe(true);
      const history = listSchemaVersionHistory(db);
      expect(history.map((row) => row.to_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect(history[0]).toMatchObject({
        from_version: 0,
        to_version: 1,
        migration_name: "001_progress_message_id",
      });
      expect(history.at(-1)).toMatchObject({
        from_version: 11,
        to_version: 12,
        migration_name: "012_recovery_outbox",
      });
    });
  });

  it("upgrades an older schema version through the remaining migrations", () => {
    withMemoryDb((db) => {
      createLegacyV4RouterSchema(db);
      runMigrations(db);

      expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
      expect(columnExists(db, "smart_router_decisions", "capabilities_json")).toBe(true);
      expect(columnExists(db, "smart_router_decisions", "classifier_elapsed_ms")).toBe(true);
      expect(columnExists(db, "smart_router_decisions", "user_choice")).toBe(true);
      expect(columnExists(db, "task_events", "payload_json")).toBe(true);
      expect(columnExists(db, "market_forecasts", "payload_json")).toBe(true);
      expect(columnExists(db, "cron_runs", "metadata_json")).toBe(true);
      expect(columnExists(db, "recovery_outbox", "payload_json")).toBe(true);
      expect(listSchemaVersionHistory(db).map((row) => row.to_version)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    });
  });

  it("does not duplicate history rows when migrations are rerun", () => {
    withMemoryDb((db) => {
      ensureBaseSchema(db);
      runMigrations(db);
      const first = listSchemaVersionHistory(db);

      runMigrations(db);

      const second = listSchemaVersionHistory(db);
      expect(second).toHaveLength(first.length);
      expect(second.map((row) => row.to_version)).toEqual(first.map((row) => row.to_version));
    });
  });

  it("does not bump user_version or record history when a migration fails", () => {
    withMemoryDb((db) => {
      const failingMigration: SchemaMigration = {
        version: 1,
        name: "001_fails",
        up() {
          throw new Error("boom");
        },
      };

      expect(() => __testables.applyMigrations(db, [failingMigration], 1)).toThrow("boom");
      expect(getSchemaVersion(db)).toBe(0);
      expect(listSchemaVersionHistory(db)).toEqual([]);
    });
  });
});
