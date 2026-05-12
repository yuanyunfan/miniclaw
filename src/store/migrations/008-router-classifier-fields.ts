import { ensureColumn } from "./helpers.js";
import type { SchemaMigration } from "./types.js";

export const migration008RouterClassifierFields: SchemaMigration = {
  version: 8,
  name: "008_router_classifier_fields",
  up(db) {
    ensureColumn(db, "smart_router_decisions", "classifier_elapsed_ms", "INTEGER");
    ensureColumn(db, "smart_router_decisions", "classifier_error_type", "TEXT");
    ensureColumn(db, "smart_router_decisions", "classifier_error_message", "TEXT");
  },
};
