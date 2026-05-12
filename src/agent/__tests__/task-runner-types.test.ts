import { describe, expect, it } from "vitest";
import type { TaskRunner, TaskRunnerInput, TaskRunnerProvider } from "../runners/types.js";

describe("TaskRunner boundary types", () => {
  it("accepts provider-neutral view events and trace facts from runners", async () => {
    const provider: TaskRunnerProvider = "fake";
    const seenViewEvents: string[] = [];
    const seenTraceEvents: string[] = [];

    const runner: TaskRunner = {
      provider,
      async run(input: TaskRunnerInput) {
        await input.onViewEvent({
          type: "task_started",
          taskId: input.taskId,
          provider,
          cwd: input.cwd,
        });
        input.onTraceEvent("runner_started", { provider });

        return {
          success: true,
          sessionId: "codex:e2e-runner-contract",
          costUsd: 0,
          durationMs: 1,
          turns: 1,
          result: "ok",
        };
      },
    };

    const result = await runner.run({
      taskId: "task-runner-contract",
      prompt: "run task",
      cwd: "/tmp/work",
      signal: new AbortController().signal,
      onViewEvent: (event) => {
        seenViewEvents.push(event.type);
      },
      onTraceEvent: (eventType) => {
        seenTraceEvents.push(eventType);
      },
    });

    expect(runner.provider).toBe("fake");
    expect(seenViewEvents).toEqual(["task_started"]);
    expect(seenTraceEvents).toEqual(["runner_started"]);
    expect(result).toMatchObject({ success: true, result: "ok" });
  });
});
