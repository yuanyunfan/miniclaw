import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDb } from "../connection.js";
import { ensureBaseSchema, runMigrations } from "../schema.js";
import {
  enqueueRecoveryOutbox,
  listRecoveryOutbox,
  markRecoveryOutboxAttemptFailed,
  markRecoveryOutboxDelivered,
} from "../recovery-outbox.js";
import { createTask } from "../repositories/tasks.js";
import {
  createCronRun,
  listCronRunsMissingAlerts,
  markCronRunAlertDelivered,
  markCronRunFailed,
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

describe("recovery outbox persistence", () => {
  it("deduplicates cron failure alert rows by cron_run_id and keeps them pending", () => {
    createCronRun({
      id: "run-1",
      jobName: "daily-job",
      jobType: "message",
      startedAt: "2026-05-13T10:00:00.000Z",
    });
    const first = enqueueRecoveryOutbox({
      kind: "cron_failure_alert",
      channelId: "channel-1",
      cronRunId: "run-1",
      jobName: "daily-job",
      payload: { cron_run_id: "run-1", error: "boom" },
      lastError: "discord down",
    });
    const second = enqueueRecoveryOutbox({
      kind: "cron_failure_alert",
      channelId: "channel-1",
      cronRunId: "run-1",
      jobName: "daily-job",
      payload: { cron_run_id: "run-1", error: "new boom" },
      lastError: "discord still down",
    });

    expect(second.id).toBe(first.id);
    const rows = listRecoveryOutbox({ kind: "cron_failure_alert", status: "pending" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.last_error).toBe("discord still down");
    expect(rows[0]?.payload_json).toContain("new boom");
  });

  it("records delivery attempts and delivered message ids", () => {
    createTask({
      id: "task-1",
      discord_thread_id: "",
      discord_user_id: "cron",
      prompt: "hello",
      cwd: "/tmp",
    });
    const row = enqueueRecoveryOutbox({
      kind: "task_result_delivery",
      channelId: "channel-1",
      taskId: "task-1",
      payload: { messages: ["hello"] },
    });

    markRecoveryOutboxAttemptFailed(row.id, "network timeout");
    let current = listRecoveryOutbox({ kind: "task_result_delivery" })[0];
    expect(current).toMatchObject({ status: "pending", attempts: 1, last_error: "network timeout" });

    current = markRecoveryOutboxDelivered(row.id, "msg-1")!;
    expect(current).toMatchObject({ status: "delivered", message_id: "msg-1" });
    expect(current.delivered_at).toBeTruthy();
  });

  it("does not reopen delivered rows when duplicate enqueue or stale failure arrives", () => {
    createTask({
      id: "task-delivered",
      discord_thread_id: "",
      discord_user_id: "cron",
      prompt: "hello",
      cwd: "/tmp",
    });
    const row = enqueueRecoveryOutbox({
      kind: "pre_provider_attachment_delivery",
      channelId: "channel-1",
      taskId: "task-delivered",
      payload: { attachments: ["first"] },
      lastError: "first failure",
    });
    markRecoveryOutboxDelivered(row.id, "msg-1");

    const duplicate = enqueueRecoveryOutbox({
      kind: "pre_provider_attachment_delivery",
      channelId: "channel-1",
      taskId: "task-delivered",
      payload: { attachments: ["second"] },
      lastError: "stale failure",
    });
    markRecoveryOutboxAttemptFailed(row.id, "late abort");

    const current = listRecoveryOutbox({ kind: "pre_provider_attachment_delivery" })[0];
    expect(duplicate.id).toBe(row.id);
    expect(current).toMatchObject({
      status: "delivered",
      message_id: "msg-1",
      attempts: 0,
      last_error: "first failure",
    });
    expect(current?.payload_json).toContain("first");
    expect(listRecoveryOutbox({ kind: "pre_provider_attachment_delivery", status: "pending" })).toEqual([]);
  });

  it("finds failed cron runs that still have no alert message id", () => {
    createCronRun({
      id: "run-missing-alert",
      jobName: "daily-job",
      jobType: "message",
      startedAt: "2026-05-13T10:00:00.000Z",
    });
    markCronRunFailed("run-missing-alert", {
      completedAt: "2026-05-13T10:01:00.000Z",
      errorMessage: "offline",
    });
    createCronRun({
      id: "run-has-alert",
      jobName: "daily-job",
      jobType: "message",
      startedAt: "2026-05-13T10:02:00.000Z",
    });
    markCronRunFailed("run-has-alert", {
      completedAt: "2026-05-13T10:03:00.000Z",
      errorMessage: "already alerted",
    });
    markCronRunAlertDelivered("run-has-alert", { messageId: "msg-1", channelId: "channel-1" });

    const rows = listCronRunsMissingAlerts({
      since: "2026-05-13T09:00:00.000Z",
      until: "2026-05-13T11:00:00.000Z",
    });

    expect(rows.map((row) => row.id)).toEqual(["run-missing-alert"]);
  });
});
