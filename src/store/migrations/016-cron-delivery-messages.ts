import type { SchemaMigration } from "./types.js";

export const migration016CronDeliveryMessages: SchemaMigration = {
  version: 16,
  name: "016_cron_delivery_messages",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cron_delivery_messages (
        id TEXT PRIMARY KEY,
        job_name TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        delivery_key TEXT NOT NULL,
        delivery_mode TEXT NOT NULL,
        task_id TEXT,
        message_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        UNIQUE(job_name, channel_id, delivery_key, delivery_mode)
      );
      CREATE INDEX IF NOT EXISTS idx_cron_delivery_messages_job_key
        ON cron_delivery_messages(job_name, channel_id, delivery_key);
    `);
  },
};
