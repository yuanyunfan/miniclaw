import { ensureColumn } from "./helpers.js";
import type { SchemaMigration } from "./types.js";

export const migration001ProgressMessageId: SchemaMigration = {
  version: 1,
  name: "001_progress_message_id",
  up(db) {
    ensureColumn(db, "tasks", "progress_message_id", "TEXT");
  },
};
