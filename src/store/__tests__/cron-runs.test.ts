import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDb } from "../connection.js";
import { ensureBaseSchema, runMigrations } from "../schema.js";
import {
  createCronRun,
  getCronRunFailureWindow,
  getCronRun,
  listCronRuns,
  listCronRunsByIdPrefix,
  markCronRunCompleted,
  markCronRunFailed,
  resolveCronRunByIdPrefix,
  summarizeCronRuns,
} from "../cron-runs.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  setDb(db);
  ensureBaseSchema(db);
  runMigrations(db);
});

afterEach(() => {
  db.close();
});

describe("cron run persistence", () => {
  it("creates a running cron run with stable scheduling metadata", () => {
    const row = createCronRun({
      id: "run-create",
      jobName: "daily-news",
      jobType: "task",
      attempt: 2,
      scheduledAt: "2026-05-12T01:00:00.000Z",
      startedAt: "2026-05-12T01:00:03.000Z",
      providerName: "wechat-mp",
      metadata: { source: "scheduler" },
    });

    expect(row).toMatchObject({
      id: "run-create",
      job_name: "daily-news",
      job_type: "task",
      status: "running",
      attempt: 2,
      scheduled_at: "2026-05-12T01:00:00.000Z",
      started_at: "2026-05-12T01:00:03.000Z",
      provider_name: "wechat-mp",
    });
    expect(JSON.parse(row.metadata_json ?? "{}")).toEqual({ source: "scheduler" });
  });

  it("marks successful and skipped runs as completed and keeps finalization idempotent", () => {
    createCronRun({
      id: "run-success",
      jobName: "morning-message",
      jobType: "message",
      startedAt: "2026-05-12T01:00:00.000Z",
    });

    const completed = markCronRunCompleted("run-success", {
      completedAt: "2026-05-12T01:00:05.000Z",
    });
    const second = markCronRunCompleted("run-success", {
      status: "skipped",
      completedAt: "2026-05-12T01:01:00.000Z",
      errorCategory: "late_skip",
    });

    expect(completed).toMatchObject({
      status: "success",
      completed_at: "2026-05-12T01:00:05.000Z",
      duration_ms: 5000,
    });
    expect(second).toMatchObject({
      status: "success",
      completed_at: "2026-05-12T01:00:05.000Z",
      duration_ms: 5000,
      error_category: null,
    });
  });

  it("marks failed attempts with task, incident, alert, and metadata links", () => {
    createCronRun({
      id: "run-failed",
      jobName: "hourly-market",
      jobType: "task",
      startedAt: "2026-05-12T02:00:00.000Z",
    });
    db.prepare(
      `INSERT INTO tasks (id, discord_thread_id, discord_user_id, prompt, cwd)
       VALUES ('task-1', '', 'cron', 'prompt', '/tmp')`
    ).run();
    db.prepare(
      `INSERT INTO incidents (id, dedupe_key, type, severity, status, title)
       VALUES ('incident-1', 'cron:hourly-market', 'cron_failed', 'warning', 'diagnosed', 'Cron failed')`
    ).run();

    const row = markCronRunFailed("run-failed", {
      status: "retry_scheduled",
      completedAt: "2026-05-12T02:00:10.000Z",
      taskId: "task-1",
      incidentId: "incident-1",
      errorCategory: "provider_auth",
      errorMessage: "session expired",
      alertMessageId: "alert-1",
      alertChannelId: "channel-1",
      metadata: { next_retry_at: "2026-05-12T02:10:10.000Z" },
    });

    expect(row).toMatchObject({
      status: "retry_scheduled",
      duration_ms: 10000,
      task_id: "task-1",
      incident_id: "incident-1",
      error_category: "provider_auth",
      error_message: "session expired",
      alert_message_id: "alert-1",
      alert_channel_id: "channel-1",
    });
    expect(JSON.parse(row.metadata_json ?? "{}")).toEqual({
      next_retry_at: "2026-05-12T02:10:10.000Z",
    });
  });

  it("lists filtered runs newest-first and summarizes status counts by job", () => {
    createCronRun({
      id: "daily-success",
      jobName: "daily-news",
      jobType: "message",
      startedAt: "2026-05-12T01:00:00.000Z",
    });
    markCronRunCompleted("daily-success", {
      completedAt: "2026-05-12T01:00:02.000Z",
    });
    createCronRun({
      id: "daily-failed",
      jobName: "daily-news",
      jobType: "message",
      attempt: 2,
      startedAt: "2026-05-12T02:00:00.000Z",
    });
    markCronRunFailed("daily-failed", {
      completedAt: "2026-05-12T02:00:01.000Z",
      errorMessage: "boom",
    });
    createCronRun({
      id: "weekly-skipped",
      jobName: "weekly-review",
      jobType: "script",
      startedAt: "2026-05-12T03:00:00.000Z",
    });
    markCronRunCompleted("weekly-skipped", {
      status: "skipped",
      completedAt: "2026-05-12T03:00:00.000Z",
      errorCategory: "script_skipped",
    });

    expect(listCronRuns({ jobName: "daily-news", limit: 10 }).map((row) => row.id)).toEqual([
      "daily-failed",
      "daily-success",
    ]);
    expect(listCronRuns({ status: "skipped", limit: 10 }).map((row) => row.id)).toEqual([
      "weekly-skipped",
    ]);

    const daily = summarizeCronRuns({ jobName: "daily-news", limit: 10 })[0];
    expect(daily).toMatchObject({
      job_name: "daily-news",
      total_runs: 2,
      success_runs: 1,
      failed_runs: 1,
      skipped_runs: 0,
      last_started_at: "2026-05-12T02:00:00.000Z",
      last_status: "failed",
    });
    expect(getCronRun("daily-success")?.status).toBe("success");
  });

  it("resolves cron run ids by exact id or unique prefix", () => {
    createCronRun({
      id: "run-prefix-alpha",
      jobName: "lookup-job",
      jobType: "message",
      startedAt: "2026-05-12T01:00:00.000Z",
    });
    createCronRun({
      id: "run-prefix-beta",
      jobName: "lookup-job",
      jobType: "message",
      startedAt: "2026-05-12T02:00:00.000Z",
    });

    expect(resolveCronRunByIdPrefix("run-prefix-alpha")).toMatchObject({
      ok: true,
      value: { id: "run-prefix-alpha" },
    });
    expect(resolveCronRunByIdPrefix("run-prefix-b")).toMatchObject({
      ok: true,
      value: { id: "run-prefix-beta" },
    });
    expect(listCronRunsByIdPrefix("run-prefix-").map((row) => row.id)).toEqual([
      "run-prefix-beta",
      "run-prefix-alpha",
    ]);
    expect(resolveCronRunByIdPrefix("run-prefix-")).toMatchObject({
      ok: false,
      error: {
        code: "ambiguous_prefix",
        matches: ["run-prefix-beta", "run-prefix-alpha"],
      },
    });
    expect(resolveCronRunByIdPrefix("missing")).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  it("computes failure windows from cron_runs and resets after a later success", () => {
    createCronRun({
      id: "window-failed-1",
      jobName: "window-job",
      jobType: "message",
      startedAt: "2026-05-12T01:00:00.000Z",
    });
    markCronRunFailed("window-failed-1", {
      completedAt: "2026-05-12T01:00:01.000Z",
      errorMessage: "boom-1",
    });
    createCronRun({
      id: "window-retry-1",
      jobName: "window-job",
      jobType: "message",
      startedAt: "2026-05-12T01:10:00.000Z",
    });
    markCronRunFailed("window-retry-1", {
      status: "retry_scheduled",
      completedAt: "2026-05-12T01:10:01.000Z",
      errorMessage: "boom-2",
    });

    expect(getCronRunFailureWindow("window-job", "2026-05-12T00:00:00.000Z")).toMatchObject({
      failure_count: 2,
      latest_failure_at: "2026-05-12T01:10:01.000Z",
      latest_success_at: null,
    });

    createCronRun({
      id: "window-success",
      jobName: "window-job",
      jobType: "message",
      startedAt: "2026-05-12T01:20:00.000Z",
    });
    markCronRunCompleted("window-success", {
      completedAt: "2026-05-12T01:20:01.000Z",
    });

    expect(getCronRunFailureWindow("window-job", "2026-05-12T00:00:00.000Z")).toMatchObject({
      failure_count: 0,
      latest_failure_at: null,
      latest_success_at: "2026-05-12T01:20:01.000Z",
    });
  });
});
