import { describe, expect, it } from "vitest";
import { claudeTaskRunner } from "../runners/claude-task-runner.js";
import { codexTaskRunner } from "../runners/codex-task-runner.js";
import { createFakeTaskRunner } from "../runners/fake-task-runner.js";

describe("task runners", () => {
  it("exports Claude and Codex runners behind the TaskRunner contract", () => {
    expect(claudeTaskRunner.provider).toBe("claude");
    expect(typeof claudeTaskRunner.run).toBe("function");
    expect(codexTaskRunner.provider).toBe("codex");
    expect(typeof codexTaskRunner.run).toBe("function");
  });

  it("fake runner emits provider-neutral view events and trace facts", async () => {
    const runner = createFakeTaskRunner("codex");
    const viewEvents: string[] = [];
    const traceEvents: Array<{ eventType: string; message?: string; payload?: unknown }> = [];

    const result = await runner.run({
      taskId: "task-runner-fake",
      prompt: "e2e task runner-fake",
      cwd: "/tmp/work",
      signal: new AbortController().signal,
      onViewEvent: (event) => {
        viewEvents.push(event.type);
      },
      onTraceEvent: (eventType, options) => {
        traceEvents.push({ eventType, message: options?.message, payload: options?.payload });
      },
    });

    expect(result).toMatchObject({
      success: true,
      sessionId: "codex:e2e-runner-fake",
      result: "E2E_TASK_OK runner-fake",
      progressLines: ["🧪 e2e fake agent"],
      toolCount: 0,
    });
    expect(viewEvents).toEqual(["session_started", "task_completed"]);
    expect(traceEvents).toEqual([
      {
        eventType: "session_started",
        message: "codex:e2e-runner-fake",
        payload: { provider: "codex", session_id: "codex:e2e-runner-fake" },
      },
    ]);
  });
});
