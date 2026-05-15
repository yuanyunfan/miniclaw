import type { SchemaMigration } from "./types.js";

export const migration014AgentSchedulerState: SchemaMigration = {
  version: 14,
  name: "014_agent_scheduler_state",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_scheduler_state (
        task_id TEXT PRIMARY KEY,
        root_run_id TEXT NOT NULL,
        scheduler_version TEXT NOT NULL,
        status TEXT NOT NULL,
        current_step TEXT NOT NULL,
        wait_run_id TEXT,
        wait_kinds_json TEXT NOT NULL DEFAULT '[]',
        last_message_id TEXT,
        plan_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (root_run_id) REFERENCES agent_runs(id),
        FOREIGN KEY (wait_run_id) REFERENCES agent_runs(id),
        FOREIGN KEY (last_message_id) REFERENCES agent_messages(id)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_scheduler_state_status_updated
        ON agent_scheduler_state(status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_agent_scheduler_state_root
        ON agent_scheduler_state(root_run_id);
    `);
  },
};
