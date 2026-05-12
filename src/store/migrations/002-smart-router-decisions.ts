import type { SchemaMigration } from "./types.js";

export const migration002SmartRouterDecisions: SchemaMigration = {
  version: 2,
  name: "002_smart_router_decisions",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS smart_router_decisions (
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
        capabilities_json TEXT,
        classifier_elapsed_ms INTEGER,
        classifier_error_type TEXT,
        classifier_error_message TEXT,
        action_result TEXT,
        created_task_id TEXT,
        user_choice TEXT,
        final_route TEXT,
        task_final_status TEXT,
        correction_type TEXT,
        correction_note TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_smart_router_decisions_message ON smart_router_decisions(message_id);
      CREATE INDEX IF NOT EXISTS idx_smart_router_decisions_created_at ON smart_router_decisions(created_at);
      CREATE INDEX IF NOT EXISTS idx_smart_router_decisions_task ON smart_router_decisions(created_task_id);
    `);
  },
};
