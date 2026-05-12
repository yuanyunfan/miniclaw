import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureBaseSchema, runMigrations } from "../schema.js";
import {
  buildStateCleanupPlan,
  formatStateCleanupReport,
  runStateCleanup,
  type StateRetentionConfig,
} from "../state-cleanup.js";

const NOW = new Date("2026-05-12T00:00:00.000Z");
const OLD = "2024-01-01T00:00:00.000Z";
const RECENT = "2026-05-01T00:00:00.000Z";

const RETENTION: StateRetentionConfig = {
  chatHistoryDays: 90,
  taskEventsDays: 90,
  smartRouterDecisionsDays: 180,
  incidentsDays: 365,
  repairRunsDays: 365,
  marketForecastsDays: 730,
  dryRunDefault: true,
};

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  ensureBaseSchema(db);
  runMigrations(db);
});

afterEach(() => {
  db.close();
});

function countRows(table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: number };
  return Number(row.count ?? 0);
}

function insertTask(id: string): void {
  db.prepare(
    `INSERT INTO tasks (id, discord_thread_id, discord_user_id, prompt, cwd, created_at)
     VALUES (@id, @thread, @user, @prompt, @cwd, @created_at)`
  ).run({
    id,
    thread: `thread-${id}`,
    user: "user-1",
    prompt: "test prompt",
    cwd: "/tmp",
    created_at: OLD,
  });
}

function insertMarketForecast(id: string, generatedAt: string): void {
  db.prepare(
    `INSERT INTO market_forecasts (
       id, market_scope, trade_date, session, generated_at, calendar_status,
       payload_json, created_at, updated_at
     ) VALUES (
       @id, 'cn', '2026-05-12', 'pre_market', @generated_at, 'open',
       '{}', @generated_at, @generated_at
     )`
  ).run({ id, generated_at: generatedAt });
  db.prepare(
    `INSERT INTO market_forecast_items (
       id, forecast_id, item_type, target, direction, evidence_ids_json, source, created_at
     ) VALUES (
       @item_id, @forecast_id, 'risk_level', 'market', 'watch', '[]', 'provider_score', @created_at
     )`
  ).run({ item_id: `${id}-item`, forecast_id: id, created_at: generatedAt });
  db.prepare(
    `INSERT INTO market_forecast_evaluations (
       id, forecast_id, evaluated_at, outcome_json, score_json, created_at
     ) VALUES (
       @evaluation_id, @forecast_id, @created_at, '{}', '{}', @created_at
     )`
  ).run({ evaluation_id: `${id}-evaluation`, forecast_id: id, created_at: generatedAt });
}

function insertIncident(id: string, status: string, updatedAt: string): void {
  db.prepare(
    `INSERT INTO incidents (
       id, dedupe_key, type, severity, status, title, created_at, updated_at, resolved_at
     ) VALUES (
       @id, @dedupe_key, 'test', 'warning', @status, @title, @created_at, @updated_at, @resolved_at
     )`
  ).run({
    id,
    dedupe_key: `dedupe-${id}`,
    status,
    title: `incident ${id}`,
    created_at: updatedAt,
    updated_at: updatedAt,
    resolved_at: status === "open" ? null : updatedAt,
  });
}

describe("state cleanup plan", () => {
  it("builds grouped cleanup targets with configured retention cutoffs", () => {
    const plan = buildStateCleanupPlan({ retention: RETENTION, now: NOW, scope: "market_forecasts" });

    expect(plan.map((target) => target.id)).toEqual([
      "market_forecast_items",
      "market_forecast_evaluations",
      "market_forecasts",
    ]);
    expect(plan[0]?.retentionDays).toBe(730);
    expect(plan[0]?.cutoffIso).toBe("2024-05-12T00:00:00.000Z");
  });
});

describe("runStateCleanup", () => {
  it("reports dry-run candidates without deleting rows", () => {
    insertTask("task-old");
    db.prepare(
      `INSERT INTO chat_history (discord_channel_id, discord_user_id, role, content, created_at)
       VALUES ('channel-1', 'user-1', 'user', 'old chat', @old),
              ('channel-1', 'user-1', 'assistant', 'recent chat', @recent)`
    ).run({ old: OLD, recent: RECENT });
    db.prepare(
      `INSERT INTO task_events (task_id, event_type, severity, created_at)
       VALUES ('task-old', 'started', 'info', @old),
              ('task-old', 'finished', 'info', @recent)`
    ).run({ old: OLD, recent: RECENT });

    const report = runStateCleanup(db, { retention: RETENTION, dryRun: true, now: NOW });

    expect(report.dryRun).toBe(true);
    expect(report.targets.find((target) => target.id === "chat_history")?.candidateCount).toBe(1);
    expect(report.targets.find((target) => target.id === "task_events")?.candidateCount).toBe(1);
    expect(report.totalDeletedCount).toBe(2);
    expect(countRows("chat_history")).toBe(2);
    expect(countRows("task_events")).toBe(2);
  });

  it("executes a single-scope task event cleanup without touching other scopes", () => {
    insertTask("task-filter");
    db.prepare(
      `INSERT INTO chat_history (discord_channel_id, discord_user_id, role, content, created_at)
       VALUES ('channel-1', 'user-1', 'user', 'old chat', @old)`
    ).run({ old: OLD });
    db.prepare(
      `INSERT INTO task_events (task_id, event_type, severity, created_at)
       VALUES ('task-filter', 'old', 'info', @old),
              ('task-filter', 'recent', 'info', @recent)`
    ).run({ old: OLD, recent: RECENT });

    const report = runStateCleanup(db, {
      retention: RETENTION,
      dryRun: false,
      scope: "task_events",
      olderThanDays: 30,
      now: NOW,
    });

    expect(report.scope).toBe("task_events");
    expect(report.totalDeletedCount).toBe(1);
    expect(countRows("task_events")).toBe(1);
    expect(countRows("chat_history")).toBe(1);
  });

  it("deletes market forecast children before old parent forecasts", () => {
    insertMarketForecast("forecast-old", "2024-01-01T00:00:00.000Z");
    insertMarketForecast("forecast-recent", RECENT);

    const report = runStateCleanup(db, {
      retention: RETENTION,
      dryRun: false,
      scope: "market_forecasts",
      olderThanDays: 30,
      now: NOW,
    });

    expect(report.targets.map((target) => [target.id, target.deletedCount])).toEqual([
      ["market_forecast_items", 1],
      ["market_forecast_evaluations", 1],
      ["market_forecasts", 1],
    ]);
    expect(countRows("market_forecasts")).toBe(1);
    expect(countRows("market_forecast_items")).toBe(1);
    expect(countRows("market_forecast_evaluations")).toBe(1);
  });

  it("keeps open incidents and their child rows while removing old closed incidents after child cleanup", () => {
    insertIncident("incident-closed", "resolved", OLD);
    insertIncident("incident-open", "open", OLD);
    db.prepare(
      `INSERT INTO incident_events (incident_id, event_type, created_at)
       VALUES ('incident-closed', 'diagnosed', @old),
              ('incident-open', 'diagnosed', @old)`
    ).run({ old: OLD });
    db.prepare(
      `INSERT INTO repair_runs (id, incident_id, status, created_at)
       VALUES ('repair-old', 'incident-closed', 'ready', @old)`
    ).run({ old: OLD });

    const report = runStateCleanup(db, { retention: RETENTION, dryRun: false, now: NOW });

    expect(report.targets.find((target) => target.id === "incident_events")?.deletedCount).toBe(1);
    expect(report.targets.find((target) => target.id === "repair_runs")?.deletedCount).toBe(1);
    expect(report.targets.find((target) => target.id === "incidents")?.deletedCount).toBe(1);
    expect(db.prepare("SELECT id FROM incidents ORDER BY id").all()).toEqual([{ id: "incident-open" }]);
    expect(db.prepare("SELECT incident_id FROM incident_events ORDER BY incident_id").all()).toEqual([
      { incident_id: "incident-open" },
    ]);
  });
});

describe("formatStateCleanupReport", () => {
  it("renders terminal-friendly dry-run output", () => {
    const report = runStateCleanup(db, {
      retention: RETENTION,
      dryRun: true,
      scope: "chat_history",
      now: NOW,
    });

    expect(formatStateCleanupReport(report)).toContain("State cleanup dry-run");
    expect(formatStateCleanupReport(report)).toContain("scope: chat_history");
  });
});
