import { randomUUID } from "node:crypto";
import { afterEach, describe, it, expect } from "vitest";
import {
  __testables,
  getActiveTaskCount,
  interruptActiveTasks,
  waitForActiveTasksToDrain,
} from "../task.js";
import { createTask, getTask, initDb } from "../../store/db.js";

const {
  fmtTokens,
  formatUsage,
  finalTaskStatus,
  selectTaskRunner,
  addActiveTaskForTest,
  deleteActiveTaskForTest,
  resetTaskRuntimeForTest,
} = __testables;

afterEach(() => {
  resetTaskRuntimeForTest();
});

describe("fmtTokens", () => {
  it("returns '-' for undefined / null", () => {
    expect(fmtTokens(undefined)).toBe("-");
    expect(fmtTokens(null as unknown as undefined)).toBe("-");
  });
  it("returns plain number under 1000", () => {
    expect(fmtTokens(0)).toBe("0");
    expect(fmtTokens(999)).toBe("999");
  });
  it("formats K under 1M", () => {
    expect(fmtTokens(1000)).toBe("1.0K");
    expect(fmtTokens(24500)).toBe("24.5K");
    expect(fmtTokens(999_999)).toBe("1000.0K");
  });
  it("formats M for ≥ 1M", () => {
    expect(fmtTokens(1_000_000)).toBe("1.00M");
    expect(fmtTokens(2_345_678)).toBe("2.35M");
  });
});

describe("formatUsage", () => {
  it("returns undefined for falsy input", () => {
    expect(formatUsage(undefined)).toBeUndefined();
    expect(formatUsage(null)).toBeUndefined();
    expect(formatUsage("not an object")).toBeUndefined();
  });
  it("returns undefined for empty object", () => {
    expect(formatUsage({})).toBeUndefined();
  });
  it("formats all 4 fields", () => {
    expect(formatUsage({
      input_tokens: 9,
      output_tokens: 2600,
      cache_read_input_tokens: 124800,
      cache_creation_input_tokens: 4900,
    })).toBe("in: 9 · out: 2.6K · cache hit: 124.8K · cache write: 4.9K");
  });
  it("skips cache fields when zero", () => {
    expect(formatUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    })).toBe("in: 100 · out: 50");
  });
  it("formats partial fields (only output)", () => {
    expect(formatUsage({ output_tokens: 1500 })).toBe("out: 1.5K");
  });
});

describe("finalTaskStatus", () => {
  it("preserves completed/failed when not cancelled", () => {
    const ctrl = new AbortController();
    expect(finalTaskStatus("task-a", ctrl, true)).toBe("completed");
    expect(finalTaskStatus("task-a", ctrl, false)).toBe("failed");
  });

  it("maps aborted controller to cancelled", () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(finalTaskStatus("task-a", ctrl, false)).toBe("cancelled");
  });

  it("maps shutdown-interrupted controller to interrupted", () => {
    initDb();
    const taskId = randomUUID();
    createTask({
      id: taskId,
      discord_thread_id: "thread-drain-status",
      discord_user_id: "u-1",
      prompt: "long task",
      cwd: "/tmp",
    });
    const ctrl = addActiveTaskForTest(taskId);

    interruptActiveTasks("shutdown interrupt");

    expect(ctrl.signal.aborted).toBe(true);
    expect(finalTaskStatus(taskId, ctrl, false)).toBe("interrupted");
  });
});

describe("selectTaskRunner", () => {
  it("uses configured providers when fake runtime is disabled", () => {
    expect(selectTaskRunner("claude", false).provider).toBe("claude");
    expect(selectTaskRunner("codex", false).provider).toBe("codex");
  });

  it("routes both configured providers through the fake runner in e2e fake mode", () => {
    expect(selectTaskRunner("claude", true).provider).toBe("fake");
    expect(selectTaskRunner("codex", true).provider).toBe("fake");
  });
});

describe("task drain helpers", () => {
  it("waitForActiveTasksToDrain resolves true when active tasks finish", async () => {
    addActiveTaskForTest("drain-task-1");

    const drained = waitForActiveTasksToDrain(1000);
    setTimeout(() => deleteActiveTaskForTest("drain-task-1"), 5);

    await expect(drained).resolves.toBe(true);
  });

  it("waitForActiveTasksToDrain resolves false on timeout", async () => {
    addActiveTaskForTest("drain-task-2");

    await expect(waitForActiveTasksToDrain(5)).resolves.toBe(false);
  });

  it("interruptActiveTasks aborts controllers and marks running rows interrupted", () => {
    initDb();
    const taskId = randomUUID();
    const reason = "Interrupted during MiniClaw shutdown drain timeout";
    createTask({
      id: taskId,
      discord_thread_id: "thread-drain-interrupt",
      discord_user_id: "u-1",
      prompt: "long task",
      cwd: "/tmp",
    });
    const ctrl = addActiveTaskForTest(taskId);

    expect(interruptActiveTasks(reason)).toEqual([taskId]);

    expect(ctrl.signal.aborted).toBe(true);
    expect(getActiveTaskCount()).toBe(0);
    expect(getTask(taskId)).toMatchObject({
      status: "interrupted",
      result_summary: reason,
    });
  });
});
