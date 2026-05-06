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
});
