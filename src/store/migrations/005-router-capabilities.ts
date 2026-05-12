import { ensureColumn } from "./helpers.js";
import type { SchemaMigration } from "./types.js";

export const migration005RouterCapabilities: SchemaMigration = {
  version: 5,
  name: "005_router_capabilities",
  up(db) {
    ensureColumn(db, "smart_router_decisions", "capabilities_json", "TEXT");
  },
};
