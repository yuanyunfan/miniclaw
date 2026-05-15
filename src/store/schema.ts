import type Database from "better-sqlite3";
import {
  columnExists,
  ensureSchemaVersionHistoryTable,
} from "./migrations/helpers.js";
import { migrations } from "./migrations/index.js";
import type { SchemaMigration } from "./migrations/types.js";

export { columnExists } from "./migrations/helpers.js";

export const SCHEMA_VERSION = 14;

export interface SchemaVersionHistoryRow {
  id: number;
  from_version: number | null;
  to_version: number;
  migration_name: string;
  applied_at: string;
}

export function getSchemaVersion(db: Database.Database): number {
  return Number(db.pragma("user_version", { simple: true }) ?? 0);
}

function setSchemaVersion(db: Database.Database, version: number): void {
  db.pragma(`user_version = ${version}`);
}

export function ensureBaseSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      discord_thread_id TEXT,
      discord_user_id TEXT,
      prompt TEXT NOT NULL,
      cwd TEXT,
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      result_summary TEXT,
      cost_usd REAL,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      progress_message_id TEXT,
      source_route_type TEXT,
      source_channel_id TEXT,
      source_message_id TEXT,
      source_message_url TEXT,
      source_metadata_json TEXT,
      parent_context_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'user',
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_channel_id TEXT NOT NULL,
      discord_user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      name TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      mode TEXT NOT NULL,
      total_cost_usd REAL DEFAULT 0,
      total_turns INTEGER DEFAULT 0,
      transcript_path TEXT
    );
    CREATE TABLE IF NOT EXISTS scene_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scene_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      speaker TEXT NOT NULL,
      content TEXT,
      tool_calls_json TEXT,
      cost_usd REAL,
      FOREIGN KEY (scene_id) REFERENCES scenes(id)
    );
    CREATE INDEX IF NOT EXISTS idx_scene_msgs_scene ON scene_messages(scene_id);
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
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      dedupe_key TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      subject_id TEXT,
      subject_type TEXT,
      source_json TEXT,
      evidence_json TEXT,
      diagnosis_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
    CREATE INDEX IF NOT EXISTS idx_incidents_updated_at ON incidents(updated_at);
    CREATE TABLE IF NOT EXISTS incident_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (incident_id) REFERENCES incidents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_incident_events_incident ON incident_events(incident_id, created_at);
    CREATE TABLE IF NOT EXISTS repair_runs (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL,
      status TEXT NOT NULL,
      workspace_path TEXT,
      branch TEXT,
      base_sha TEXT,
      commit_sha TEXT,
      verification_json TEXT,
      report_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (incident_id) REFERENCES incidents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_repair_runs_incident ON repair_runs(incident_id, created_at);
    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      message TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_task_events_type ON task_events(event_type, created_at);
    CREATE TABLE IF NOT EXISTS market_forecasts (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      job_name TEXT,
      channel_id TEXT,
      market_scope TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      session TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      calendar_status TEXT NOT NULL,
      data_quality_status TEXT,
      payload_json TEXT NOT NULL,
      report_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_market_forecasts_task ON market_forecasts(task_id);
    CREATE INDEX IF NOT EXISTS idx_market_forecasts_scope_date ON market_forecasts(market_scope, trade_date, session);
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
    CREATE TABLE IF NOT EXISTS recovery_outbox (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      channel_id TEXT NOT NULL,
      cron_run_id TEXT,
      task_id TEXT,
      job_name TEXT,
      payload_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      message_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      delivered_at TEXT,
      FOREIGN KEY (cron_run_id) REFERENCES cron_runs(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_recovery_outbox_status_kind
      ON recovery_outbox(status, kind, created_at);
    CREATE INDEX IF NOT EXISTS idx_recovery_outbox_channel
      ON recovery_outbox(channel_id, status, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_outbox_cron_run_kind
      ON recovery_outbox(kind, cron_run_id)
      WHERE cron_run_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_outbox_task_kind
      ON recovery_outbox(kind, task_id)
      WHERE task_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      parent_run_id TEXT,
      controller_run_id TEXT,
      requester_run_id TEXT,
      role TEXT NOT NULL,
      runtime TEXT NOT NULL,
      provider_session_id TEXT,
      status TEXT NOT NULL,
      spawn_depth INTEGER NOT NULL DEFAULT 0,
      control_scope TEXT NOT NULL,
      context_mode TEXT NOT NULL DEFAULT 'isolated',
      cwd TEXT NOT NULL,
      tool_policy_id TEXT NOT NULL,
      can_spawn INTEGER NOT NULL DEFAULT 0,
      can_write_workspace INTEGER NOT NULL DEFAULT 0,
      can_send_kinds_json TEXT NOT NULL DEFAULT '[]',
      can_receive_kinds_json TEXT NOT NULL DEFAULT '[]',
      route_json TEXT,
      prompt_context_hash TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      error_message TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (parent_run_id) REFERENCES agent_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_task_status_created
      ON agent_runs(task_id, status, started_at);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_parent_status
      ON agent_runs(parent_run_id, status);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_requester_status
      ON agent_runs(requester_run_id, status);
    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      from_run_id TEXT NOT NULL,
      to_run_id TEXT,
      kind TEXT NOT NULL,
      content_text TEXT,
      payload_json TEXT,
      artifact_ids_json TEXT NOT NULL DEFAULT '[]',
      causal_message_id TEXT,
      delivered_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (from_run_id) REFERENCES agent_runs(id),
      FOREIGN KEY (to_run_id) REFERENCES agent_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages_task_created
      ON agent_messages(task_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_messages_to_created
      ON agent_messages(to_run_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_messages_from_created
      ON agent_messages(from_run_id, created_at);
    CREATE TABLE IF NOT EXISTS blackboard_facts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      key TEXT NOT NULL,
      content TEXT NOT NULL,
      source_message_id TEXT NOT NULL,
      confidence TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (source_message_id) REFERENCES agent_messages(id),
      UNIQUE(task_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_blackboard_facts_task_key_status
      ON blackboard_facts(task_id, key, status);
    CREATE TABLE IF NOT EXISTS agent_artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT,
      summary TEXT,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (run_id) REFERENCES agent_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_artifacts_task_run_created
      ON agent_artifacts(task_id, run_id, created_at);
    CREATE TABLE IF NOT EXISTS market_forecast_items (
      id TEXT PRIMARY KEY,
      forecast_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      target TEXT NOT NULL,
      direction TEXT NOT NULL,
      probability REAL,
      confidence REAL,
      evidence_ids_json TEXT NOT NULL DEFAULT '[]',
      invalidation TEXT,
      rationale TEXT,
      source TEXT NOT NULL DEFAULT 'provider_score',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (forecast_id) REFERENCES market_forecasts(id)
    );
    CREATE INDEX IF NOT EXISTS idx_market_forecast_items_forecast ON market_forecast_items(forecast_id, item_type);
    CREATE TABLE IF NOT EXISTS market_forecast_evaluations (
      id TEXT PRIMARY KEY,
      forecast_id TEXT NOT NULL,
      evaluated_at TEXT NOT NULL,
      outcome_json TEXT NOT NULL,
      score_json TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (forecast_id) REFERENCES market_forecasts(id)
    );
    CREATE INDEX IF NOT EXISTS idx_market_forecast_evaluations_forecast ON market_forecast_evaluations(forecast_id, evaluated_at);
    CREATE TABLE IF NOT EXISTS schema_version_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_version INTEGER,
      to_version INTEGER NOT NULL,
      migration_name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_schema_version_history_to_version
      ON schema_version_history(to_version);
  `);
}

function recordMigration(
  db: Database.Database,
  migration: SchemaMigration,
  fromVersion: number,
): void {
  db.prepare(
    `INSERT INTO schema_version_history (from_version, to_version, migration_name)
     VALUES (@from_version, @to_version, @migration_name)`
  ).run({
    from_version: fromVersion,
    to_version: migration.version,
    migration_name: migration.name,
  });
}

function applyMigrations(
  db: Database.Database,
  migrationList: SchemaMigration[],
  expectedVersion: number,
): void {
  ensureSchemaVersionHistoryTable(db);
  let current = getSchemaVersion(db);

  for (const migration of migrationList) {
    if (current >= migration.version) continue;
    if (migration.version !== current + 1) {
      throw new Error(`Database migration gap: current=${current}, next=${migration.version}`);
    }

    const apply = db.transaction((fromVersion: number) => {
      migration.up(db);
      setSchemaVersion(db, migration.version);
      recordMigration(db, migration, fromVersion);
    });
    apply(current);
    current = getSchemaVersion(db);
  }

  const after = getSchemaVersion(db);
  if (after < expectedVersion) {
    throw new Error(`Database schema migration incomplete: user_version=${after}, expected=${expectedVersion}`);
  }
}

export function runMigrations(db: Database.Database): void {
  applyMigrations(db, migrations, SCHEMA_VERSION);
}

export function listSchemaVersionHistory(db: Database.Database): SchemaVersionHistoryRow[] {
  ensureSchemaVersionHistoryTable(db);
  return db
    .prepare("SELECT * FROM schema_version_history ORDER BY to_version ASC")
    .all() as SchemaVersionHistoryRow[];
}

export const __testables = {
  applyMigrations,
  setSchemaVersion,
};
