import { ensureColumn } from "./helpers.js";
import type { SchemaMigration } from "./types.js";

export const migration003TaskSourceContext: SchemaMigration = {
  version: 3,
  name: "003_task_source_context",
  up(db) {
    ensureColumn(db, "tasks", "source_route_type", "TEXT");
    ensureColumn(db, "tasks", "source_channel_id", "TEXT");
    ensureColumn(db, "tasks", "source_message_id", "TEXT");
    ensureColumn(db, "tasks", "source_message_url", "TEXT");
    ensureColumn(db, "tasks", "source_metadata_json", "TEXT");
    ensureColumn(db, "tasks", "parent_context_json", "TEXT");
  },
};
