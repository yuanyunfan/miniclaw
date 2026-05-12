import { describe, expect, it } from "vitest";
import { redactTaskViewText, taskViewEvents } from "../task-view-events.js";

describe("redactTaskViewText", () => {
  it("compacts whitespace and redacts common secret shapes", () => {
    const text = redactTaskViewText(`
      running command
      token=abc123
      password: "hunter2"
      Authorization: Bearer secret-token-123456
      sk-1234567890abcdef
    `);

    expect(text).toBe(
      "running command token=[REDACTED] password: \"[REDACTED]\" Authorization: [REDACTED] [REDACTED]"
    );
  });

  it("supports bounded progress text without forcing final output truncation", () => {
    expect(redactTaskViewText("abcdef", { maxChars: 5 })).toBe("ab...");
    expect(redactTaskViewText("abcdef")).toBe("abcdef");
  });
});

describe("taskViewEvents", () => {
  it("builds provider-neutral lifecycle events", () => {
    expect(taskViewEvents.taskStarted({
      taskId: "task-1",
      provider: "codex",
      model: "gpt-test",
      cwd: "/tmp/work",
    })).toEqual({
      type: "task_started",
      taskId: "task-1",
      provider: "codex",
      model: "gpt-test",
      cwd: "/tmp/work",
    });

    expect(taskViewEvents.sessionStarted("codex", "codex:session-1")).toEqual({
      type: "session_started",
      provider: "codex",
      sessionId: "codex:session-1",
    });
    expect(taskViewEvents.turnStarted("codex", 2)).toEqual({
      type: "turn_started",
      provider: "codex",
      turn: 2,
    });
  });

  it("redacts user-visible progress and error text by construction", () => {
    expect(taskViewEvents.toolProgress({
      provider: "claude",
      title: "Bash token=secret123",
      detail: "Authorization: Bearer abcdefghijklmnop",
      severity: "warning",
    })).toEqual({
      type: "tool_progress",
      provider: "claude",
      title: "Bash token=[REDACTED]",
      detail: "Authorization: [REDACTED]",
      severity: "warning",
    });

    expect(taskViewEvents.providerError("codex", "failed api_key='secret123'", "rate_limit")).toEqual({
      type: "provider_error",
      provider: "codex",
      message: "failed api_key='[REDACTED]'",
      errorType: "rate_limit",
    });
  });

  it("redacts task result text without mutating the runner result object", () => {
    const result = {
      success: true,
      sessionId: "codex:session-1",
      costUsd: 0,
      durationMs: 25,
      turns: 1,
      result: "done with sk-1234567890abcdef",
    };

    const event = taskViewEvents.taskCompleted(result);

    expect(event).toEqual({
      type: "task_completed",
      result: {
        ...result,
        result: "done with [REDACTED]",
      },
    });
    expect(result.result).toBe("done with sk-1234567890abcdef");
  });
});
