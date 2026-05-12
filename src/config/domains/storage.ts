import type { ConfigReader } from "../env.js";
import { resolveHome } from "../resolve.js";

export function buildStorageRuntimeConfig(reader: ConfigReader) {
  return {
    dbPath: resolveHome(reader.requiredString(["storage", "db_path"], "MINICLAW_DB_PATH", "~/.miniclaw/data.db")),
    memoryPath: resolveHome(reader.requiredString(
      ["storage", "memory_path"],
      "MINICLAW_MEMORY_PATH",
      "~/.miniclaw/memories/MEMORY.md"
    )),
    state: {
      retention: {
        chatHistoryDays: reader.positiveInt(
          ["state", "retention", "chat_history_days"],
          "MINICLAW_STATE_RETENTION_CHAT_HISTORY_DAYS",
          90
        ),
        taskEventsDays: reader.positiveInt(
          ["state", "retention", "task_events_days"],
          "MINICLAW_STATE_RETENTION_TASK_EVENTS_DAYS",
          90
        ),
        smartRouterDecisionsDays: reader.positiveInt(
          ["state", "retention", "smart_router_decisions_days"],
          "MINICLAW_STATE_RETENTION_SMART_ROUTER_DECISIONS_DAYS",
          180
        ),
        incidentsDays: reader.positiveInt(
          ["state", "retention", "incidents_days"],
          "MINICLAW_STATE_RETENTION_INCIDENTS_DAYS",
          365
        ),
        repairRunsDays: reader.positiveInt(
          ["state", "retention", "repair_runs_days"],
          "MINICLAW_STATE_RETENTION_REPAIR_RUNS_DAYS",
          365
        ),
        marketForecastsDays: reader.positiveInt(
          ["state", "retention", "market_forecasts_days"],
          "MINICLAW_STATE_RETENTION_MARKET_FORECASTS_DAYS",
          730
        ),
        dryRunDefault: reader.boolValue(
          ["state", "retention", "dry_run_default"],
          "MINICLAW_STATE_RETENTION_DRY_RUN_DEFAULT",
          true
        ),
      },
    },
  } as const;
}
