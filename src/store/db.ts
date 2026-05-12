import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { config } from "../config.js";

let db: Database.Database;
export const SCHEMA_VERSION = 9;

export function getDb(): Database.Database {
  return db;
}

export function getSchemaVersion(): number {
  return Number(db.pragma("user_version", { simple: true }) ?? 0);
}

export const TASK_STATUSES = [
  "queued",
  "running",
  "interrupted",
  "completed",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

const ALLOWED_UPDATE_FIELDS = new Set([
  "session_id", "status", "result_summary", "cost_usd", "duration_ms", "completed_at", "progress_message_id",
]);

export function initDb(): void {
  mkdirSync(dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
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
	  `);

  runMigrations();
}

function setSchemaVersion(version: number): void {
  db.pragma(`user_version = ${version}`);
}

function columnExists(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  return rows.some((r) => r.name === column);
}

function ensureColumn(table: string, column: string, definition: string): void {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function runMigrations(): void {
  const current = getSchemaVersion();

  // v1: existing DBs before 0.4.0 did not persist the Discord progress message id.
  if (current < 1) {
    ensureColumn("tasks", "progress_message_id", "TEXT");
    setSchemaVersion(1);
  }

  // v2: persist redacted smart-router decisions for false-positive/negative review.
  if (current < 2) {
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
    setSchemaVersion(2);
  }

  // v3: persist Discord source metadata and reply/parent context for task prompts.
  if (current < 3) {
    ensureColumn("tasks", "source_route_type", "TEXT");
    ensureColumn("tasks", "source_channel_id", "TEXT");
    ensureColumn("tasks", "source_message_id", "TEXT");
    ensureColumn("tasks", "source_message_url", "TEXT");
    ensureColumn("tasks", "source_metadata_json", "TEXT");
    ensureColumn("tasks", "parent_context_json", "TEXT");
    setSchemaVersion(3);
  }

  // v4: persist Auto Doctor incidents and future repair runs.
  if (current < 4) {
    db.exec(`
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
    `);
    setSchemaVersion(4);
  }

  // v5: persist capability-router details for false-positive/negative review.
  if (current < 5) {
    ensureColumn("smart_router_decisions", "capabilities_json", "TEXT");
    setSchemaVersion(5);
  }

  // v6: persist normalized task events for Auto Doctor trace diagnosis.
  if (current < 6) {
    db.exec(`
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
    `);
    setSchemaVersion(6);
  }

  // v7: persist market-intel pre-market forecasts and later evaluation rows.
  if (current < 7) {
    db.exec(`
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
    `);
    setSchemaVersion(7);
  }

  // v8: persist classifier timing and failure details for router debugging.
  if (current < 8) {
    ensureColumn("smart_router_decisions", "classifier_elapsed_ms", "INTEGER");
    ensureColumn("smart_router_decisions", "classifier_error_type", "TEXT");
    ensureColumn("smart_router_decisions", "classifier_error_message", "TEXT");
    setSchemaVersion(8);
  }

  // v9: persist router evaluation-loop facts: user choice, final route, task outcome, and correction metadata.
  if (current < 9) {
    ensureColumn("smart_router_decisions", "user_choice", "TEXT");
    ensureColumn("smart_router_decisions", "final_route", "TEXT");
    ensureColumn("smart_router_decisions", "task_final_status", "TEXT");
    ensureColumn("smart_router_decisions", "correction_type", "TEXT");
    ensureColumn("smart_router_decisions", "correction_note", "TEXT");
    ensureColumn("smart_router_decisions", "resolved_at", "TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_smart_router_decisions_task ON smart_router_decisions(created_task_id)");
    setSchemaVersion(9);
  }

  const after = getSchemaVersion();
  if (after < SCHEMA_VERSION) {
    throw new Error(`Database schema migration incomplete: user_version=${after}, expected=${SCHEMA_VERSION}`);
  }
}

export const __testables = { columnExists, runMigrations };

export interface TaskRow {
  id: string;
  discord_thread_id: string | null;
  discord_user_id: string;
  prompt: string;
  cwd: string | null;
  session_id: string | null;
  status: string;
  result_summary: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
  progress_message_id: string | null;
  source_route_type: string | null;
  source_channel_id: string | null;
  source_message_id: string | null;
  source_message_url: string | null;
  source_metadata_json: string | null;
  parent_context_json: string | null;
}

export function createTask(task: {
  id: string;
  discord_thread_id: string;
  discord_user_id: string;
  prompt: string;
  cwd: string;
  source_route_type?: string;
  source_channel_id?: string;
  source_message_id?: string;
  source_message_url?: string;
  source_metadata_json?: string;
  parent_context_json?: string;
}): void {
  const row = {
    ...task,
    source_route_type: task.source_route_type ?? null,
    source_channel_id: task.source_channel_id ?? null,
    source_message_id: task.source_message_id ?? null,
    source_message_url: task.source_message_url ?? null,
    source_metadata_json: task.source_metadata_json ?? null,
    parent_context_json: task.parent_context_json ?? null,
  };
  db.prepare(
    `INSERT INTO tasks (
       id, discord_thread_id, discord_user_id, prompt, cwd,
       source_route_type, source_channel_id, source_message_id, source_message_url,
       source_metadata_json, parent_context_json
     )
     VALUES (
       @id, @discord_thread_id, @discord_user_id, @prompt, @cwd,
       @source_route_type, @source_channel_id, @source_message_id, @source_message_url,
       @source_metadata_json, @parent_context_json
     )`
  ).run(row);
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<TaskRow, "session_id" | "status" | "result_summary" | "cost_usd" | "duration_ms" | "completed_at" | "progress_message_id">
  >
): void {
  const safeKeys = Object.keys(updates).filter((k) => ALLOWED_UPDATE_FIELDS.has(k));
  if (!safeKeys.length) return;
  const sets = safeKeys.map((k) => `${k} = @${k}`).join(", ");
  const params: Record<string, unknown> = { id };
  for (const k of safeKeys) params[k] = (updates as Record<string, unknown>)[k];
  const result = db.prepare(`UPDATE tasks SET ${sets} WHERE id = @id`).run(params);
  if (result.changes > 0 && typeof updates.status === "string") {
    recordSmartRouterTaskOutcome(id, updates.status);
  }
}

function assertTaskRows(rows: unknown[]): TaskRow[] {
  for (const r of rows) {
    if (!r || typeof r !== "object" || !("id" in r) || !("status" in r)) {
      throw new Error("Unexpected task row shape from database");
    }
  }
  return rows as TaskRow[];
}

export function getTask(id: string): TaskRow | undefined {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  if (!row) return undefined;
  return assertTaskRows([row])[0];
}

export function getTaskByThreadId(threadId: string): TaskRow | undefined {
  const row = db.prepare(
    `SELECT * FROM tasks
     WHERE discord_thread_id = ? AND session_id IS NOT NULL
     ORDER BY created_at DESC, rowid DESC LIMIT 1`
  ).get(threadId);
  if (!row) return undefined;
  return assertTaskRows([row])[0];
}

export function getActiveTasks(): TaskRow[] {
  return assertTaskRows(db.prepare("SELECT * FROM tasks WHERE status = 'running' ORDER BY created_at DESC").all());
}

export function getInterruptedTasks(limit = 5): TaskRow[] {
  return assertTaskRows(
    db.prepare("SELECT * FROM tasks WHERE status = 'interrupted' ORDER BY completed_at DESC LIMIT ?").all(limit)
  );
}

export function markTaskInterrupted(id: string, resultSummary?: string): void {
  const result = db.prepare(
    `UPDATE tasks
     SET status = 'interrupted',
         result_summary = COALESCE(@result_summary, result_summary),
         completed_at = datetime('now')
     WHERE id = @id AND status = 'running'`
  ).run({ id, result_summary: resultSummary ?? null });
  if (result.changes > 0) recordSmartRouterTaskOutcome(id, "interrupted");
}

export function getRecentTasks(limit = 10): TaskRow[] {
  return assertTaskRows(db.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?").all(limit));
}

export function addChatMessage(channelId: string, userId: string, role: string, content: string): void {
  db.prepare(
    `INSERT INTO chat_history (discord_channel_id, discord_user_id, role, content) VALUES (?, ?, ?, ?)`
  ).run(channelId, userId, role, content);
}

export function getChatHistory(
  channelId: string,
  limit = 20
): Array<{ role: string; content: string }> {
  return db
    .prepare(
      `SELECT role, content FROM chat_history
       WHERE discord_channel_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(channelId, limit) as Array<{ role: string; content: string }>;
}

export interface SmartRouterDecisionRow {
  id: number;
  message_id: string;
  channel_id: string;
  user_id: string;
  prompt_hash: string;
  prompt_preview: string | null;
  full_prompt: string | null;
  intent: string;
  confidence: number;
  reason: string | null;
  matched_signals: string;
  risk_flags: string;
  capabilities_json: string | null;
  classifier_elapsed_ms: number | null;
  classifier_error_type: string | null;
  classifier_error_message: string | null;
  action_result: string | null;
  created_task_id: string | null;
  user_choice: string | null;
  final_route: string | null;
  task_final_status: string | null;
  correction_type: string | null;
  correction_note: string | null;
  resolved_at: string | null;
  created_at: string;
}

export type SmartRouterUserChoice =
  | "accepted_task"
  | "continued_chat"
  | "cancelled"
  | "ignored"
  | "auto_task_no_choice";
export type SmartRouterFinalRoute = "chat" | "task" | "none";
export type SmartRouterTaskFinalStatus = "completed" | "failed" | "cancelled" | "interrupted" | "not_created";
export type SmartRouterCorrectionType =
  | "false_positive"
  | "false_negative"
  | "classifier_error"
  | "policy_blocked"
  | "user_override"
  | "none";

export interface SmartRouterReviewRow extends SmartRouterDecisionRow {
  linked_task_status: string | null;
}

export function recordSmartRouterDecision(row: {
  message_id: string;
  channel_id: string;
  user_id: string;
  prompt_hash: string;
  prompt_preview?: string;
  full_prompt?: string;
  intent: string;
  confidence: number;
  reason?: string;
  matched_signals?: string[];
  risk_flags?: string[];
  capabilities_json?: string;
  classifier_elapsed_ms?: number;
  classifier_error_type?: string;
  classifier_error_message?: string;
  action_result?: string;
  created_task_id?: string;
  user_choice?: SmartRouterUserChoice;
  final_route?: SmartRouterFinalRoute;
  task_final_status?: SmartRouterTaskFinalStatus;
  correction_type?: SmartRouterCorrectionType;
  correction_note?: string;
  resolved_at?: string;
}): number {
  const result = db.prepare(
    `INSERT INTO smart_router_decisions (
      message_id, channel_id, user_id, prompt_hash, prompt_preview, full_prompt,
      intent, confidence, reason, matched_signals, risk_flags, capabilities_json,
      classifier_elapsed_ms, classifier_error_type, classifier_error_message,
      action_result, created_task_id, user_choice, final_route, task_final_status,
      correction_type, correction_note, resolved_at
    ) VALUES (
      @message_id, @channel_id, @user_id, @prompt_hash, @prompt_preview, @full_prompt,
      @intent, @confidence, @reason, @matched_signals, @risk_flags, @capabilities_json,
      @classifier_elapsed_ms, @classifier_error_type, @classifier_error_message,
      @action_result, @created_task_id, @user_choice, @final_route, @task_final_status,
      @correction_type, @correction_note, @resolved_at
    )`
  ).run({
    message_id: row.message_id,
    channel_id: row.channel_id,
    user_id: row.user_id,
    prompt_hash: row.prompt_hash,
    prompt_preview: row.prompt_preview ?? null,
    full_prompt: row.full_prompt ?? null,
    intent: row.intent,
    confidence: row.confidence,
    reason: row.reason ?? null,
    matched_signals: JSON.stringify(row.matched_signals ?? []),
    risk_flags: JSON.stringify(row.risk_flags ?? []),
    capabilities_json: row.capabilities_json ?? null,
    classifier_elapsed_ms: row.classifier_elapsed_ms ?? null,
    classifier_error_type: row.classifier_error_type ?? null,
    classifier_error_message: row.classifier_error_message ?? null,
    action_result: row.action_result ?? null,
    created_task_id: row.created_task_id ?? null,
    user_choice: row.user_choice ?? null,
    final_route: row.final_route ?? null,
    task_final_status: row.task_final_status ?? null,
    correction_type: row.correction_type ?? null,
    correction_note: row.correction_note ?? null,
    resolved_at: row.resolved_at ?? null,
  });
  return Number(result.lastInsertRowid);
}

export interface SmartRouterDecisionUpdate {
  action_result?: string | null;
  created_task_id?: string | null;
  user_choice?: SmartRouterUserChoice | null;
  final_route?: SmartRouterFinalRoute | null;
  task_final_status?: SmartRouterTaskFinalStatus | null;
  correction_type?: SmartRouterCorrectionType | null;
  correction_note?: string | null;
  resolved_at?: string | null;
}

export function updateSmartRouterDecision(
  id: number,
  updates: SmartRouterDecisionUpdate
): void {
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };
  for (const key of [
    "action_result",
    "created_task_id",
    "user_choice",
    "final_route",
    "task_final_status",
    "correction_type",
    "correction_note",
    "resolved_at",
  ] as const) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = @${key}`);
      params[key] = updates[key];
    }
  }
  if (!fields.length) return;
  db.prepare(`UPDATE smart_router_decisions SET ${fields.join(", ")} WHERE id = @id`).run(params);
}

function resolvedAtNow(): string {
  return new Date().toISOString();
}

function normalizeTaskFinalStatus(status: string): SmartRouterTaskFinalStatus | undefined {
  if (status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted") {
    return status;
  }
  return undefined;
}

export function recordSmartRouterUserChoice(
  id: number,
  choice: SmartRouterUserChoice,
  finalRoute: SmartRouterFinalRoute,
  updates: Omit<SmartRouterDecisionUpdate, "user_choice" | "final_route"> = {}
): void {
  const terminal = finalRoute !== "task" || updates.task_final_status !== undefined;
  updateSmartRouterDecision(id, {
    user_choice: choice,
    final_route: finalRoute,
    correction_type: "none",
    ...updates,
    ...(terminal && updates.resolved_at === undefined ? { resolved_at: resolvedAtNow() } : {}),
  });
}

export function recordSmartRouterTaskOutcome(taskId: string, status: string): number {
  const taskFinalStatus = normalizeTaskFinalStatus(status);
  if (!taskFinalStatus) return 0;
  const result = db.prepare(
    `UPDATE smart_router_decisions
     SET task_final_status = @task_final_status,
         final_route = COALESCE(final_route, 'task'),
         correction_type = COALESCE(correction_type, 'none'),
         resolved_at = @resolved_at
     WHERE created_task_id = @task_id`
  ).run({
    task_id: taskId,
    task_final_status: taskFinalStatus,
    resolved_at: resolvedAtNow(),
  });
  return Number(result.changes ?? 0);
}

export function getRecentSmartRouterDecisions(limit = 20): SmartRouterDecisionRow[] {
  return db
    .prepare("SELECT * FROM smart_router_decisions ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(limit) as SmartRouterDecisionRow[];
}

export function listSmartRouterReviewRows(options: {
  since?: string;
  until?: string;
  channelId?: string;
  limit?: number;
} = {}): SmartRouterReviewRow[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {
    limit: Math.max(1, Math.min(options.limit ?? 200, 1000)),
  };
  if (options.since) {
    where.push("d.created_at >= @since");
    params.since = options.since;
  }
  if (options.until) {
    where.push("d.created_at <= @until");
    params.until = options.until;
  }
  if (options.channelId) {
    where.push("d.channel_id = @channel_id");
    params.channel_id = options.channelId;
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return db.prepare(
    `SELECT d.*, t.status AS linked_task_status
     FROM smart_router_decisions d
     LEFT JOIN tasks t ON t.id = d.created_task_id
     ${whereSql}
     ORDER BY d.created_at DESC, d.id DESC
     LIMIT @limit`
  ).all(params) as SmartRouterReviewRow[];
}

// ===== Stage 子系统：scenes / scene_messages =====

export interface SceneRow {
  id: string;
  name: string | null;
  started_at: string;
  ended_at: string | null;
  mode: string;
  total_cost_usd: number | null;
  total_turns: number | null;
  transcript_path: string | null;
}

export interface SceneMessageRow {
  id: number;
  scene_id: string;
  ts: string;
  speaker: string;
  content: string | null;
  tool_calls_json: string | null;
  cost_usd: number | null;
}

export function createScene(scene: {
  id: string;
  name?: string;
  mode: string;
  transcript_path?: string;
}): void {
  db.prepare(
    `INSERT INTO scenes (id, name, started_at, mode, transcript_path)
     VALUES (@id, @name, datetime('now'), @mode, @transcript_path)`
  ).run({
    id: scene.id,
    name: scene.name ?? null,
    mode: scene.mode,
    transcript_path: scene.transcript_path ?? null,
  });
}

export function updateSceneTotals(
  id: string,
  updates: { total_cost_usd?: number; total_turns?: number; ended_at?: string | null; name?: string | null }
): void {
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };
  for (const k of ["total_cost_usd", "total_turns", "ended_at", "name"] as const) {
    if (k in updates) {
      fields.push(`${k} = @${k}`);
      params[k] = updates[k] ?? null;
    }
  }
  if (!fields.length) return;
  db.prepare(`UPDATE scenes SET ${fields.join(", ")} WHERE id = @id`).run(params);
}

export function getScene(id: string): SceneRow | undefined {
  return db.prepare("SELECT * FROM scenes WHERE id = ?").get(id) as SceneRow | undefined;
}

export function getSceneByName(name: string): SceneRow | undefined {
  return db.prepare("SELECT * FROM scenes WHERE name = ? ORDER BY started_at DESC LIMIT 1").get(name) as SceneRow | undefined;
}

export function listRecentScenes(limit = 20): SceneRow[] {
  return db.prepare("SELECT * FROM scenes ORDER BY started_at DESC LIMIT ?").all(limit) as SceneRow[];
}

export function appendSceneMessage(msg: {
  scene_id: string;
  ts: string;
  speaker: string;
  content?: string;
  tool_calls_json?: string;
  cost_usd?: number;
}): void {
  db.prepare(
    `INSERT INTO scene_messages (scene_id, ts, speaker, content, tool_calls_json, cost_usd)
     VALUES (@scene_id, @ts, @speaker, @content, @tool_calls_json, @cost_usd)`
  ).run({
    scene_id: msg.scene_id,
    ts: msg.ts,
    speaker: msg.speaker,
    content: msg.content ?? null,
    tool_calls_json: msg.tool_calls_json ?? null,
    cost_usd: msg.cost_usd ?? null,
  });
}

export function getSceneMessages(sceneId: string): SceneMessageRow[] {
  return db
    .prepare("SELECT * FROM scene_messages WHERE scene_id = ? ORDER BY id ASC")
    .all(sceneId) as SceneMessageRow[];
}
