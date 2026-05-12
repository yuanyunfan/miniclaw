import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Client } from "discord.js";
import { __testables, requestCronRetryNow } from "../scheduler.js";
import { getJobState, resetStateCache } from "../state.js";
import type { CronJobMessage } from "../types.js";
import { setDb } from "../../store/connection.js";
import { listCronRuns } from "../../store/cron-runs.js";
import { ensureBaseSchema, runMigrations } from "../../store/schema.js";

function messageJob(): CronJobMessage {
  return {
    name: "slow-message",
    schedule: "* * * * *",
    enabled: true,
    type: "message",
    channel: "1000000000000000000",
    content: "hello",
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition not met");
}

function clientWithFailingSends(failuresBeforeSuccess: number): { client: Client; sendCount: () => number } {
  let sends = 0;
  const client = {
    channels: {
      fetch: async () => ({
        isSendable: () => true,
        send: async () => {
          sends++;
          if (sends <= failuresBeforeSuccess) throw new Error(`boom-${sends}`);
          return {};
        },
      }),
    },
  } as unknown as Client;
  return { client, sendCount: () => sends };
}

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  setDb(db);
  ensureBaseSchema(db);
  runMigrations(db);
  const dir = mkdtempSync(join(tmpdir(), "miniclaw-scheduler-state-"));
  process.env.MINICLAW_CRON_STATE = join(dir, "state.json");
  resetStateCache();
});

afterEach(() => {
  db.close();
});

describe("cron scheduler dispatch", () => {
  it("normalizes single and multiple cron schedules", () => {
    const job = messageJob();
    expect(__testables.getCronSchedules(job)).toEqual(["* * * * *"]);
    expect(__testables.getCronSchedules({
      ...job,
      schedule: ["30 21-23 * * 1-5", "30 0 * * 2-6"],
    })).toEqual(["30 21-23 * * 1-5", "30 0 * * 2-6"]);
  });

  it("同名 job 上一次未完成时跳过本次触发并记录 error", async () => {
    const gate = deferred();
    let sendStarted = false;
    const client = {
      channels: {
        fetch: async () => ({
          isSendable: () => true,
          send: async () => {
            sendStarted = true;
            await gate.promise;
            return {};
          },
        }),
      },
    } as unknown as Client;
    const job = messageJob();

    const firstRun = __testables.dispatch(job, client);
    while (!sendStarted) await new Promise((resolve) => setTimeout(resolve, 0));

    await __testables.dispatch(job, client);
    expect(getJobState(job.name)?.last_status).toBe("error");
    expect(getJobState(job.name)?.last_error).toContain("previous run still active");

    gate.resolve();
    await firstRun;
  });

  it("失败后按 10m 起步指数退避重试，最多总尝试 5 次", async () => {
    const delays: number[] = [];
    const { client, sendCount } = clientWithFailingSends(4);
    const policy = {
      ...__testables.DEFAULT_RETRY_POLICY,
      sleep: async (ms: number) => { delays.push(ms); },
    };

    await __testables.dispatch(messageJob(), client, policy);

    expect(sendCount()).toBe(5);
    expect(delays).toEqual([
      10 * 60 * 1000,
      20 * 60 * 1000,
      40 * 60 * 1000,
      80 * 60 * 1000,
    ]);
    const state = getJobState("slow-message");
    expect(state?.last_status).toBe("ok");
    expect(state?.completed).toBe(5);
  });

  it("records durable cron_runs rows for successful dispatches", async () => {
    const job = { ...messageJob(), name: "history-success" };
    const { client } = clientWithFailingSends(0);

    await __testables.dispatch(job, client);

    const rows = listCronRuns({ jobName: job.name, limit: 5 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      job_name: "history-success",
      job_type: "message",
      status: "success",
      attempt: 1,
    });
    expect(rows[0]?.started_at).toBeTruthy();
    expect(rows[0]?.completed_at).toBeTruthy();
    expect(rows[0]?.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("records retry_scheduled and final success attempts in cron_runs", async () => {
    const job = { ...messageJob(), name: "history-retry" };
    const { client } = clientWithFailingSends(1);
    const policy = {
      ...__testables.DEFAULT_RETRY_POLICY,
      maxAttempts: 2,
      sleep: async () => {},
    };

    await __testables.dispatch(job, client, policy);

    const rows = listCronRuns({ jobName: job.name, limit: 5 }).sort((a, b) => a.attempt - b.attempt);
    expect(rows.map((row) => [row.attempt, row.status])).toEqual([
      [1, "retry_scheduled"],
      [2, "success"],
    ]);
    expect(rows[0]?.error_message).toContain("boom-1");
    expect(JSON.parse(rows[0]?.metadata_json ?? "{}")).toMatchObject({
      failure_run_id: expect.any(String),
      retry_delay_ms: 10 * 60 * 1000,
    });
  });

  it("第 5 次仍失败时停止重试并记录 retries exhausted", async () => {
    const delays: number[] = [];
    const { client, sendCount } = clientWithFailingSends(Number.POSITIVE_INFINITY);
    const policy = {
      ...__testables.DEFAULT_RETRY_POLICY,
      sleep: async (ms: number) => { delays.push(ms); },
    };

    await __testables.dispatch(messageJob(), client, policy);

    expect(sendCount()).toBe(5);
    expect(delays).toEqual([
      10 * 60 * 1000,
      20 * 60 * 1000,
      40 * 60 * 1000,
      80 * 60 * 1000,
    ]);
    const state = getJobState("slow-message");
    expect(state?.last_status).toBe("error");
    expect(state?.last_error).toContain("attempt 5/5");
    expect(state?.last_error).toContain("retries exhausted");
    expect(state?.completed).toBe(5);
  });

  it("定时触发失败时发送一条带立即重试按钮的失败通知", async () => {
    let jobSends = 0;
    const alertMessage = {
      id: "alert-1",
      edit: vi.fn(async (_payload: unknown) => alertMessage),
    };
    const alertSends: unknown[] = [];
    const client = {
      channels: {
        fetch: async () => ({
          isSendable: () => true,
          send: async (payload: unknown) => {
            if (typeof payload === "string") {
              jobSends++;
              throw new Error("message failed token=secret-value");
            }
            alertSends.push(payload);
            return alertMessage;
          },
        }),
      },
    } as unknown as Client;
    const policy = {
      ...__testables.DEFAULT_RETRY_POLICY,
      maxAttempts: 1,
    };

    await __testables.dispatch(messageJob(), client, policy, { notifyFailures: true });

    expect(jobSends).toBe(1);
    expect(alertSends).toHaveLength(1);
    expect(JSON.stringify(alertSends[0])).toContain("定时任务执行失败");
    expect(JSON.stringify(alertSends[0])).toContain("立即重新执行");
    expect(JSON.stringify(alertSends[0])).not.toContain("secret-value");
    const state = getJobState("slow-message");
    expect(state?.last_status).toBe("error");
    expect(state?.failure_run_id).toBeTruthy();
    expect(state?.failure_alert_message_id).toBe("alert-1");
  });

  it("同一次失败重试链路中后续失败会 edit 同一条失败通知", async () => {
    let jobSends = 0;
    const alertMessage = {
      id: "alert-1",
      edit: vi.fn(async (_payload: unknown) => alertMessage),
    };
    const alertSends: unknown[] = [];
    const client = {
      channels: {
        fetch: async () => ({
          isSendable: () => true,
          send: async (payload: unknown) => {
            if (typeof payload === "string") {
              jobSends++;
              throw new Error(`job-failed-${jobSends}`);
            }
            alertSends.push(payload);
            return alertMessage;
          },
        }),
      },
    } as unknown as Client;
    const policy = {
      ...__testables.DEFAULT_RETRY_POLICY,
      maxAttempts: 2,
      sleep: async () => {},
    };

    await __testables.dispatch(messageJob(), client, policy, { notifyFailures: true });

    expect(jobSends).toBe(2);
    expect(alertSends).toHaveLength(1);
    expect(alertMessage.edit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(alertMessage.edit.mock.calls[0][0])).toContain("尝试次数: 2/2");
  });

  it("失败后自动重试成功会 edit 失败通知为已恢复并移除按钮", async () => {
    let jobSends = 0;
    const alertMessage = {
      id: "alert-1",
      edit: vi.fn(async (_payload: unknown) => alertMessage),
    };
    const client = {
      channels: {
        fetch: async () => ({
          isSendable: () => true,
          send: async (payload: unknown) => {
            if (typeof payload === "string") {
              jobSends++;
              if (jobSends === 1) throw new Error("temporary boom");
              return { id: "job-ok" };
            }
            return alertMessage;
          },
        }),
      },
    } as unknown as Client;
    const policy = {
      ...__testables.DEFAULT_RETRY_POLICY,
      maxAttempts: 2,
      sleep: async () => {},
    };

    await __testables.dispatch(messageJob(), client, policy, { notifyFailures: true });

    expect(jobSends).toBe(2);
    expect(alertMessage.edit).toHaveBeenCalledTimes(1);
    const editPayload = alertMessage.edit.mock.calls[0][0] as { content: string; components: unknown[] };
    expect(editPayload.content).toContain("定时任务已恢复成功");
    expect(editPayload.components).toEqual([]);
    expect(getJobState("slow-message")?.last_status).toBe("ok");
  });

  it("立即重试按钮可以唤醒等待中的 retry backoff", async () => {
    let jobSends = 0;
    let sleepStarted = false;
    let beforeRunCalled = false;
    let secondSendSawBeforeRun = false;
    const alertMessage = {
      id: "alert-1",
      edit: vi.fn(async (_payload: unknown) => alertMessage),
    };
    const client = {
      channels: {
        fetch: async () => ({
          isSendable: () => true,
          send: async (payload: unknown) => {
            if (typeof payload === "string") {
              jobSends++;
              if (jobSends === 1) throw new Error("temporary boom");
              secondSendSawBeforeRun = beforeRunCalled;
              return { id: "job-ok" };
            }
            return alertMessage;
          },
        }),
      },
    } as unknown as Client;
    const policy = {
      ...__testables.DEFAULT_RETRY_POLICY,
      maxAttempts: 2,
      sleep: async () => {
        sleepStarted = true;
        await new Promise<void>(() => {});
      },
    };

    const run = __testables.dispatch(messageJob(), client, policy, { notifyFailures: true });
    await waitFor(() => sleepStarted && Boolean(getJobState("slow-message")?.failure_run_id));

    const runId = getJobState("slow-message")?.failure_run_id;
    expect(runId).toBeTruthy();
    const result = await requestCronRetryNow(runId!, client, {
      beforeRun: async () => {
        beforeRunCalled = true;
      },
    });

    expect(result).toEqual({ ok: true, status: "woke", jobName: "slow-message" });
    await run;
    expect(jobSends).toBe(2);
    expect(secondSendSawBeforeRun).toBe(true);
    expect(getJobState("slow-message")?.last_status).toBe("ok");
  });
});
