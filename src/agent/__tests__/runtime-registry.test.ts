import { describe, expect, it, vi } from "vitest";
import { getAgentRuntime, getDefaultAgentRuntime, listAgentRuntimeIds, resolveDefaultAgentRuntimeId } from "../runtimes/registry.js";
import { claudeTaskRunner } from "../runners/claude-task-runner.js";
import type { TaskRunnerResult } from "../runners/types.js";

describe("agent runtime registry", () => {
  it("lists and resolves current coding agent runtimes", () => {
    expect(listAgentRuntimeIds()).toEqual(["claude", "codex"]);
    expect(getAgentRuntime("claude")).toMatchObject({
      id: "claude",
      kind: "coding_agent",
      capabilities: {
        resumeSession: true,
        cancel: true,
        toolEvents: true,
        workspaceWrite: true,
      },
    });
    expect(getAgentRuntime("codex").id).toBe("codex");
  });

  it("maps legacy agentProvider to the default runtime id", () => {
    expect(resolveDefaultAgentRuntimeId({ agentProvider: "claude" })).toBe("claude");
    expect(resolveDefaultAgentRuntimeId({ agentProvider: "codex" })).toBe("codex");
    expect(getDefaultAgentRuntime({ agentProvider: "codex" }).id).toBe("codex");
  });

  it("allows the future runtime default to override the compatibility alias", () => {
    expect(resolveDefaultAgentRuntimeId({
      agentProvider: "claude",
      runtime: { default_agent: "codex" },
    })).toBe("codex");
    expect(resolveDefaultAgentRuntimeId({
      agentProvider: "codex",
      runtime: { defaultAgent: "claude" },
    })).toBe("claude");
  });

  it("rejects unknown runtime ids before task execution", () => {
    expect(() => getAgentRuntime("openclaw")).toThrow(/Unknown agent runtime: openclaw/);
    expect(() => resolveDefaultAgentRuntimeId({
      agentProvider: "claude",
      runtime: { default_agent: "openclaw" },
    })).toThrow(/Unknown default agent runtime: openclaw/);
  });

  it("delegates runtime task execution to the existing task runner", async () => {
    const originalRun = claudeTaskRunner.run;
    const result: TaskRunnerResult = {
      success: true,
      sessionId: "claude:sess-test",
      costUsd: 0,
      durationMs: 1,
      turns: 1,
      result: "ok",
    };
    const run = vi.fn().mockResolvedValue(result);
    claudeTaskRunner.run = run;

    try {
      const signal = new AbortController().signal;
      await expect(getAgentRuntime("claude").startTask({
        taskId: "task-1",
        prompt: "do work",
        cwd: "/tmp/work",
        attachments: {
          contentBlocks: [{ type: "text", text: "attachment" }],
          inputEntries: [{ type: "input_text", text: "attachment" }],
        },
        managedContext: {
          taskId: "task-1",
          runId: "run-1",
          role: "planner",
        },
        signal,
        onViewEvent: () => undefined,
        onTraceEvent: () => undefined,
      })).resolves.toBe(result);

      expect(run).toHaveBeenCalledWith(expect.objectContaining({
        taskId: "task-1",
        prompt: "do work",
        cwd: "/tmp/work",
        attachmentBlocks: [{ type: "text", text: "attachment" }],
        attachmentCodexInputs: [{ type: "input_text", text: "attachment" }],
        managedContext: {
          taskId: "task-1",
          runId: "run-1",
          role: "planner",
        },
        signal,
      }));
    } finally {
      claudeTaskRunner.run = originalRun;
    }
  });
});
