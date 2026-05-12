import type { SchemaMigration } from "./types.js";

export const migration011CronRuns: SchemaMigration = {
  version: 11,
  name: "011_cron_runs",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cron_runs (
        id TEXT PRIMARY KEY,
        job_name TEXT NOT NULL,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        scheduled_at TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER,
        task_id TEXT,
        incident_id TEXT,
        provider_name TEXT,
        provider_status TEXT,
        provider_category TEXT,
        error_category TEXT,
        error_message TEXT,
        alert_message_id TEXT,
        alert_channel_id TEXT,
        metadata_json TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (incident_id) REFERENCES incidents(id)
      );
      CREATE INDEX IF NOT EXISTS idx_cron_runs_job_started ON cron_runs(job_name, started_at);
      CREATE INDEX IF NOT EXISTS idx_cron_runs_status_started ON cron_runs(status, started_at);
    `);
  },
};
