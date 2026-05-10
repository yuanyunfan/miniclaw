import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import type { CronJobTask } from "../types.js";

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  executeTask: vi.fn(),
  getActiveTaskCount: vi.fn(() => 0),
}));

vi.mock("../../store/db.js", () => ({
  createTask: mocks.createTask,
}));

vi.mock("../../agent/task.js", () => ({
  executeTask: mocks.executeTask,
  getActiveTaskCount: mocks.getActiveTaskCount,
}));

function taskJob(): CronJobTask {
  return {
    name: "daily-ai-news",
    schedule: "* * * * *",
    enabled: true,
    type: "task",
    channel: "1000000000000000000",
    prompt: "summarize AI news",
  };
}

function client(): Client {
  return {
    channels: {
      fetch: async () => ({
        isSendable: () => true,
        send: async () => ({ id: "message-1" }),
      }),
    },
  } as unknown as Client;
}

beforeEach(() => {
  mocks.createTask.mockReset();
  mocks.executeTask.mockReset();
  mocks.getActiveTaskCount.mockReset();
  mocks.getActiveTaskCount.mockReturnValue(0);
});

describe("cron task runner", () => {
  it("throws when the underlying task returns success=false so scheduler can retry", async () => {
    const { runTask } = await import("../runner-task.js");
    mocks.executeTask.mockResolvedValue({
      success: false,
      sessionId: "codex:thread-1",
      costUsd: 0,
      durationMs: 1800000,
      turns: 1,
      result: "The operation was aborted",
    });

    await expect(runTask(taskJob(), client())).rejects.toThrow(
      "daily-ai-news task failed: The operation was aborted",
    );
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      source_route_type: "cron_task",
      source_channel_id: "1000000000000000000",
    }));
  });

  it("resolves when the underlying task succeeds", async () => {
    const { runTask } = await import("../runner-task.js");
    mocks.executeTask.mockResolvedValue({
      success: true,
      sessionId: "codex:thread-1",
      costUsd: 0,
      durationMs: 1000,
      turns: 1,
      result: "ok",
    });

    await expect(runTask(taskJob(), client())).resolves.toBeUndefined();
  });
});
