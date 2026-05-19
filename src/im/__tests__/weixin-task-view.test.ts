import { describe, expect, it, vi } from "vitest";
import { WeixinTaskViewReporter } from "../adapters/weixin/task-view.js";

async function flushTimers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("WeixinTaskViewReporter", () => {
  it("does not throw when progress delivery fails and retries once", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("send failed"))
      .mockResolvedValue(undefined);
    const reporter = new WeixinTaskViewReporter({
      taskId: "task-weixin-delivery",
      prompt: "run diagnostics",
      cwd: "/tmp/work",
      send,
      progressIntervalMs: 0,
      sendRetryDelayMs: 0,
    });

    await expect(reporter.handle({
      type: "tool_progress",
      provider: "codex",
      title: "terminal",
      detail: "sqlite3 data.db",
    })).resolves.toBeUndefined();

    await flushTimers();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toContain("task task-wei 执行中");
  });

  it("does not throw when delivery throws synchronously", async () => {
    const send = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error("sync send failed");
      })
      .mockResolvedValue(undefined);
    const reporter = new WeixinTaskViewReporter({
      taskId: "task-weixin-start",
      prompt: "run diagnostics",
      cwd: "/tmp/work",
      send,
      sendRetryDelayMs: 0,
    });

    await expect(reporter.start()).resolves.toBeUndefined();

    await flushTimers();

    expect(send).toHaveBeenCalledTimes(2);
  });

  it("suppresses final delivery errors so task completion state is not converted to runtime failure", async () => {
    const send = vi.fn().mockRejectedValue(new Error("send failed"));
    const onFinalDeliveryFailed = vi.fn();
    const reporter = new WeixinTaskViewReporter({
      taskId: "task-weixin-final",
      prompt: "run diagnostics",
      cwd: "/tmp/work",
      send,
      sendRetryDelayMs: 0,
      onFinalDeliveryFailed,
    });

    await expect(reporter.finish({
      success: true,
      sessionId: "codex:test",
      costUsd: 0,
      durationMs: 1200,
      turns: 1,
      result: "done",
    }, "completed")).resolves.toBeUndefined();

    await flushTimers();

    expect(send).toHaveBeenCalledTimes(2);
    expect(onFinalDeliveryFailed).toHaveBeenCalledTimes(1);
    expect(onFinalDeliveryFailed.mock.calls[0]?.[0][0]).toContain("MiniClaw task task-wei 已完成");
    expect(onFinalDeliveryFailed.mock.calls[0]?.[1].message).toBe("send failed");
  });
});
