import type { SchemaMigration } from "./types.js";

export const migration006TaskEvents: SchemaMigration = {
  version: 6,
  name: "006_task_events",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        message TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );
      CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_task_events_type ON task_events(event_type, created_at);
    `);
  },
};
