import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Client } from "discord.js";
import { __testables } from "../scheduler.js";
import { getJobState, resetStateCache } from "../state.js";
import type { CronJobMessage } from "../types.js";

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

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "miniclaw-scheduler-state-"));
  process.env.MINICLAW_CRON_STATE = join(dir, "state.json");
  resetStateCache();
});

describe("cron scheduler dispatch", () => {
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
});
