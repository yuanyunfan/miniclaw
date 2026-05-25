import type { SchemaMigration } from "./types.js";

export const migration019TaskControlEvents: SchemaMigration = {
  version: 19,
  name: "019_task_control_events",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_control_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        payload_json TEXT NOT NULL,
        discord_message_id TEXT,
        actor_id TEXT,
        created_at TEXT NOT NULL,
        consumed_at TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );
      CREATE INDEX IF NOT EXISTS idx_task_control_events_task_status
        ON task_control_events(task_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_task_control_events_created
        ON task_control_events(created_at);
    `);
  },
};
