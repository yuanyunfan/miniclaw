import { ensureSchemaVersionHistoryTable } from "./helpers.js";
import type { SchemaMigration } from "./types.js";

export const migration010SchemaVersionHistory: SchemaMigration = {
  version: 10,
  name: "010_schema_version_history",
  up(db) {
    ensureSchemaVersionHistoryTable(db);
  },
};
