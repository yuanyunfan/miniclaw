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
  selectTaskRuntime,
  resolveAgentRunManagerRoute,
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

describe("selectTaskRuntime", () => {
  it("uses the configured registry runtime when fake runtime is disabled", () => {
    expect(selectTaskRuntime({ agentProvider: "claude", e2e: { fakeAgent: false } }).runtime.id).toBe("claude");
    expect(selectTaskRuntime({ agentProvider: "codex", e2e: { fakeAgent: false } }).runtime.id).toBe("codex");
  });

  it("allows the future default runtime shape to override the compatibility alias", () => {
    expect(selectTaskRuntime({
      agentProvider: "claude",
      runtime: { default_agent: "codex" },
      e2e: { fakeAgent: false },
    }).runtime.id).toBe("codex");
  });

  it("wraps the selected runtime with the fake task runner in e2e fake mode", async () => {
    const selected = selectTaskRuntime({ agentProvider: "codex", e2e: { fakeAgent: true } });
    const viewEvents: string[] = [];
    const traceEvents: string[] = [];

    const result = await selected.runtime.startTask({
      taskId: "task-fake-runtime",
      prompt: "e2e task helper-runtime",
      cwd: "/tmp/work",
      signal: new AbortController().signal,
      onViewEvent: (event) => {
        viewEvents.push(event.type);
      },
      onTraceEvent: (eventType) => {
        traceEvents.push(eventType);
      },
    });

    expect(selected).toMatchObject({
      provider: "codex",
      logProvider: "e2e-fake",
      includeToolCount: false,
    });
    expect(result).toMatchObject({
      success: true,
      sessionId: "codex:e2e-helper-runtime",
      result: "E2E_TASK_OK helper-runtime",
    });
    expect(viewEvents).toEqual(["session_started", "task_completed"]);
    expect(traceEvents).toEqual(["session_started"]);
  });
});

describe("resolveAgentRunManagerRoute", () => {
  it("keeps the single-agent path when explicit and auto manager routing are disabled", () => {
    const decision = resolveAgentRunManagerRoute({
      routing: { enabled: false, autoEnabled: false, complexityMinScore: 4 },
      task: { prompt: "修一下 README 里的错别字" },
    });

    expect(decision).toMatchObject({
      useManaged: false,
      mode: "off",
    });
  });

  it("uses the manager when the explicit flag is enabled regardless of complexity", () => {
    const decision = resolveAgentRunManagerRoute({
      routing: { enabled: true, autoEnabled: false, complexityMinScore: 999 },
      task: { prompt: "简单看一下状态" },
    });

    expect(decision).toMatchObject({
      useManaged: true,
      mode: "force",
    });
  });

  it("auto-routes doc-driven multi-step implementation tasks through the manager", () => {
    const decision = resolveAgentRunManagerRoute({
      routing: { enabled: false, autoEnabled: true, complexityMinScore: 4 },
      task: {
        prompt: [
          "按照 docs/plans/2026-05-14-agent-run-manager.md",
          "继续完成 C6 的 implementation plan、runtime lifecycle、tests 和 verification plan。",
        ].join("\n"),
      },
    });

    expect(decision.mode).toBe("auto");
    expect(decision.useManaged).toBe(true);
    expect(decision.level).not.toBe("low");
    expect(decision.reasons).toEqual(expect.arrayContaining(["multi_step_plan", "doc_driven_context"]));
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
