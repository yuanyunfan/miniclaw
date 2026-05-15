import { describe, expect, it } from "vitest";
import {
  claudeTaskRunner,
  managedAgentBusAllowedTools,
  mergeManagedAgentBusMcpServers,
} from "../runners/claude-task-runner.js";
import { codexTaskRunner } from "../runners/codex-task-runner.js";
import { createFakeTaskRunner } from "../runners/fake-task-runner.js";

describe("task runners", () => {
  it("exports Claude and Codex runners behind the TaskRunner contract", () => {
    expect(claudeTaskRunner.provider).toBe("claude");
    expect(typeof claudeTaskRunner.run).toBe("function");
    expect(codexTaskRunner.provider).toBe("codex");
    expect(typeof codexTaskRunner.run).toBe("function");
  });

  it("merges managed Agent Bus MCP into Claude runner options", () => {
    const managedContext = {
      taskId: "task-claude-bus",
      runId: "run-claude-child",
      role: "planner",
      agentBusMcp: {
        serverName: "miniclaw-agent-bus",
        serverConfig: {
          type: "stdio" as const,
          command: "pnpm",
          args: ["--dir", "/repo/miniclaw", "run", "mcp:agent-bus"],
          env: { MINICLAW_AGENT_BUS_RUN_ID: "run-claude-child" },
        },
        allowedTools: ["mcp__miniclaw-agent-bus__post_message"],
        promptBlock: "live bus",
      },
    };

    expect(mergeManagedAgentBusMcpServers({ exa: { command: "exa" } }, managedContext)).toMatchObject({
      exa: { command: "exa" },
      "miniclaw-agent-bus": {
        command: "pnpm",
        env: { MINICLAW_AGENT_BUS_RUN_ID: "run-claude-child" },
      },
    });
    expect(managedAgentBusAllowedTools(managedContext)).toEqual(["mcp__miniclaw-agent-bus__post_message"]);
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
