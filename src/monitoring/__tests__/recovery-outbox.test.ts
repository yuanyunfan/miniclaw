import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Client } from "discord.js";
import { setDb } from "../../store/connection.js";
import { ensureBaseSchema, runMigrations } from "../../store/schema.js";
import {
  createCronRun,
  getCronRun,
  markCronRunFailed,
} from "../../store/cron-runs.js";
import {
  enqueueTaskResultDelivery,
  flushRecoveryOutbox,
} from "../recovery-outbox.js";
import { listRecoveryOutbox } from "../../store/recovery-outbox.js";
import { createTask } from "../../store/repositories/tasks.js";
import type { ConnectivitySnapshot } from "../connectivity-core.js";

let db: Database.Database;
let previousCronDir: string | undefined;

function clientRecordingSends(sent: unknown[]): Client {
  let nextId = 1;
  return {
    channels: {
      fetch: async () => ({
        isSendable: () => true,
        send: async (payload: unknown) => {
          sent.push(payload);
          return { id: `msg-${nextId++}` };
        },
      }),
    },
  } as unknown as Client;
}

beforeEach(() => {
  db = new Database(":memory:");
  setDb(db);
  ensureBaseSchema(db);
  runMigrations(db);
  previousCronDir = process.env.MINICLAW_CRON_DIR;
  const cronDir = mkdtempSync(join(tmpdir(), "miniclaw-recovery-cron-"));
  process.env.MINICLAW_CRON_DIR = cronDir;
  writeFileSync(join(cronDir, "daily-job.yaml"), `
name: daily-job
schedule: "* * * * *"
enabled: true
type: message
channel: "123456789012345678"
content: "hello"
`);
});

afterEach(() => {
  if (previousCronDir === undefined) delete process.env.MINICLAW_CRON_DIR;
  else process.env.MINICLAW_CRON_DIR = previousCronDir;
  db.close();
});

describe("recovery outbox flush", () => {
  it("backfills failed cron runs from an outage window and sends one recovery summary", async () => {
    createCronRun({
      id: "cron-run-1",
      jobName: "daily-job",
      jobType: "message",
      startedAt: "2026-05-13T10:00:00.000Z",
    });
    markCronRunFailed("cron-run-1", {
      completedAt: "2026-05-13T10:01:00.000Z",
      errorCategory: "Error",
      errorMessage: "getaddrinfo ENOTFOUND discord.com (attempt 5/5; retries exhausted)",
    });
    const snapshot: ConnectivitySnapshot = {
      updated_at: "2026-05-13T10:10:00.000Z",
      status: "recovered",
      consecutive_failures: 0,
      last_outage_started_at: "2026-05-13T09:59:00.000Z",
      checks: {
        discord_gateway: { ok: true },
        discord_rest: { ok: true },
        general_network: { ok: true },
        smtp: { ok: true },
      },
    };
    const sent: unknown[] = [];

    const result = await flushRecoveryOutbox(clientRecordingSends(sent), { snapshot });

    expect(result).toMatchObject({ backfilledCronAlerts: 1, cronAlertsDelivered: 1, failedAttempts: 0 });
    expect(String(sent[0])).toContain("网络中断期间错过的定时任务失败通知");
    expect(String(sent[0])).toContain("daily-job");
    expect(getCronRun("cron-run-1")?.alert_message_id).toBe("msg-1");
    expect(listRecoveryOutbox({ kind: "cron_failure_alert" })[0]?.status).toBe("delivered");
  });

  it("delivers pending task results after Discord becomes reachable", async () => {
    createTask({
      id: "task-1",
      discord_thread_id: "",
      discord_user_id: "cron",
      prompt: "hello",
      cwd: "/tmp",
    });
    enqueueTaskResultDelivery({
      channelId: "channel-1",
      taskId: "task-1",
      jobName: "daily-job",
      route: "cron_task",
      success: true,
      durationMs: 1234,
      messages: ["final result"],
      deliveryError: "discord down",
    });
    const sent: unknown[] = [];

    const result = await flushRecoveryOutbox(clientRecordingSends(sent));

    expect(result).toMatchObject({ taskDeliveriesDelivered: 1, failedAttempts: 0 });
    expect(String(sent[0])).toContain("补发任务结果");
    expect(sent).toContain("final result");
    expect(listRecoveryOutbox({ kind: "task_result_delivery" })[0]?.status).toBe("delivered");
  });
});
