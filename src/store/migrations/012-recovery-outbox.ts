import type { SchemaMigration } from "./types.js";

export const migration012RecoveryOutbox: SchemaMigration = {
  version: 12,
  name: "012_recovery_outbox",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS recovery_outbox (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        channel_id TEXT NOT NULL,
        cron_run_id TEXT,
        task_id TEXT,
        job_name TEXT,
        payload_json TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        message_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        delivered_at TEXT,
        FOREIGN KEY (cron_run_id) REFERENCES cron_runs(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );
      CREATE INDEX IF NOT EXISTS idx_recovery_outbox_status_kind
        ON recovery_outbox(status, kind, created_at);
      CREATE INDEX IF NOT EXISTS idx_recovery_outbox_channel
        ON recovery_outbox(channel_id, status, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_outbox_cron_run_kind
        ON recovery_outbox(kind, cron_run_id)
        WHERE cron_run_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_outbox_task_kind
        ON recovery_outbox(kind, task_id)
        WHERE task_id IS NOT NULL;
    `);
  },
};
