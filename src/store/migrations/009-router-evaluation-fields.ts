import { ensureColumn } from "./helpers.js";
import type { SchemaMigration } from "./types.js";

export const migration009RouterEvaluationFields: SchemaMigration = {
  version: 9,
  name: "009_router_evaluation_fields",
  up(db) {
    ensureColumn(db, "smart_router_decisions", "user_choice", "TEXT");
    ensureColumn(db, "smart_router_decisions", "final_route", "TEXT");
    ensureColumn(db, "smart_router_decisions", "task_final_status", "TEXT");
    ensureColumn(db, "smart_router_decisions", "correction_type", "TEXT");
    ensureColumn(db, "smart_router_decisions", "correction_note", "TEXT");
    ensureColumn(db, "smart_router_decisions", "resolved_at", "TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_smart_router_decisions_task ON smart_router_decisions(created_task_id)");
  },
};
