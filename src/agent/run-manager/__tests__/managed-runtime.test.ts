import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDb } from "../../../store/connection.js";
import { ensureBaseSchema, runMigrations } from "../../../store/schema.js";
import { createTask } from "../../../store/repositories/tasks.js";
import { getAgentSchedulerState, listActiveFacts, listArtifactsForRun, listRunsForTask } from "../../../store/agent-run-manager.js";
import type { AgentRuntime, AgentTaskInput, AgentTaskResult } from "../../../runtime/agent-runtime.js";
import { TaskReporter } from "../../task-reporter.js";
import { AgentRunManager } from "../manager.js";

let db: Database.Database;
let tmp: string;

function fakeChannel() {
  return {
    id: "channel-managed-runtime",
    send: vi.fn(async () => ({ id: "message-managed-runtime", edit: vi.fn(), delete: vi.fn() })),
  };
}

function envelope(value: Record<string, unknown>): string {
  return [
    "```miniclaw_agent_envelope",
    JSON.stringify(value, null, 2),
    "```",
  ].join("\n");
}

function taskResult(result: string, sessionId: string, success = true): AgentTaskResult {
  return {
    success,
    sessionId,
    costUsd: 0,
    durationMs: 1,
    turns: 1,
    result,
    progressLines: [],
    toolCount: 0,
  };
}

function fakeRuntime(results: AgentTaskResult[]): AgentRuntime {
  return {
    id: "codex",
    kind: "coding_agent",
    capabilities: { resumeSession: true, cancel: true, toolEvents: true, workspaceWrite: true },
    startTask: vi.fn(async () => {
      const next = results.shift();
      if (!next) throw new Error("fake runtime exhausted");
      return next;
    }),
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  ensureBaseSchema(db);
  runMigrations(db);
  setDb(db);
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-managed-runtime-"));
  createTask({
    id: "task-managed-runtime",
    discord_thread_id: "thread-managed-runtime",
    discord_user_id: "user-1",
    prompt: "managed runtime task",
    cwd: tmp,
  });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("AgentRunManager managed runtime fallback", () => {
  it("runs provider child envelopes and applies bounded evaluator fix loop", async () => {
    const runtime = fakeRuntime([
      taskResult(envelope({
        summary: "planner ready",
        messages: [{ kind: "handoff", content_text: "build artifact" }],
      }), "codex:planner"),
      taskResult(envelope({
        summary: "first implementation",
        artifacts: [{ kind: "markdown", title: "First artifact", content: "# First\n" }],
        blackboard_facts: [{ key: "implementation", content: "first draft", confidence: "medium" }],
      }), "codex:generator-1"),
      taskResult(envelope({
        summary: "needs fix",
        verdict: "FAIL",
        fix_list: ["add verifier evidence"],
      }), "codex:evaluator-1"),
      taskResult(envelope({
        summary: "fixed implementation",
        artifacts: [{ kind: "markdown", title: "Fixed artifact", content: "# Fixed\n" }],
        blackboard_facts: [{ key: "implementation", content: "fixed draft", confidence: "high" }],
      }), "codex:generator-2"),
      taskResult(envelope({
        summary: "accepted",
        verdict: "PASS",
      }), "codex:evaluator-2"),
    ]);
    const events: unknown[] = [];
    const manager = new AgentRunManager({
      taskId: "task-managed-runtime",
      cwd: tmp,
      provider: "codex",
      reporter: new TaskReporter("task-managed-runtime"),
      channel: fakeChannel() as never,
    });

    const result = await manager.runManagedRuntime({
      prompt: "managed runtime task",
      runtime,
      signal: new AbortController().signal,
      maxFixIterations: 1,
      onViewEvent: (event) => { events.push(event); },
    });

    expect(result.success).toBe(true);
    expect(result.result).toContain("Verdict: PASS");
    const runs = listRunsForTask("task-managed-runtime");
    expect(runs.map((run) => run.role)).toEqual(["supervisor", "planner", "generator", "evaluator", "generator", "evaluator"]);
    expect(runs.every((run) => run.status === "completed")).toBe(true);
    const generators = runs.filter((run) => run.role === "generator");
    expect(listArtifactsForRun(generators[0]?.id ?? "")).toHaveLength(1);
    expect(listArtifactsForRun(generators[1]?.id ?? "")).toHaveLength(1);
    expect(listActiveFacts("task-managed-runtime")).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "implementation", content: "fixed draft", confidence: "high" }),
      expect.objectContaining({ key: "final_verdict", content: "PASS", confidence: "high" }),
    ]));
    expect(getAgentSchedulerState("task-managed-runtime")).toMatchObject({
      status: "completed",
      current_step: "completed",
      scheduler_version: "managed-runtime-v1",
      plan_json: expect.objectContaining({ max_fix_iterations: 1 }),
    });
    expect(events.some((event) => typeof event === "object" && event !== null && (event as { type?: string }).type === "tool_progress")).toBe(true);
  });

  it("returns controlled failure when evaluator keeps failing after max fix iterations", async () => {
    const runtime = fakeRuntime([
      taskResult(envelope({ summary: "planner ready" }), "codex:planner"),
      taskResult(envelope({ summary: "first implementation" }), "codex:generator-1"),
      taskResult(envelope({ summary: "needs fix", verdict: "FAIL", fix_list: ["try again"] }), "codex:evaluator-1"),
      taskResult(envelope({ summary: "second implementation" }), "codex:generator-2"),
      taskResult(envelope({ summary: "still failing", verdict: "FAIL", fix_list: ["stop"] }), "codex:evaluator-2"),
    ]);
    const manager = new AgentRunManager({
      taskId: "task-managed-runtime",
      cwd: tmp,
      provider: "codex",
      reporter: new TaskReporter("task-managed-runtime"),
      channel: fakeChannel() as never,
    });

    const result = await manager.runManagedRuntime({
      prompt: "managed runtime task",
      runtime,
      signal: new AbortController().signal,
      maxFixIterations: 1,
      onViewEvent: () => undefined,
    });

    expect(result.success).toBe(false);
    expect(result.result).toContain("Verdict: FAIL");
    expect(listRunsForTask("task-managed-runtime").find((run) => run.role === "supervisor")?.status).toBe("failed");
    expect(getAgentSchedulerState("task-managed-runtime")).toMatchObject({
      status: "failed",
      current_step: "completed",
    });
  });

  it("passes live Agent Bus MCP managed context into provider child runs", async () => {
    const childInputs: AgentTaskInput[] = [];
    const runtime: AgentRuntime = {
      id: "codex",
      kind: "coding_agent",
      capabilities: { resumeSession: true, cancel: true, toolEvents: true, workspaceWrite: true },
      startTask: vi.fn(async (input) => {
        childInputs.push(input);
        if (childInputs.length === 1) return taskResult(envelope({ summary: "planner ready" }), "codex:planner");
        if (childInputs.length === 2) return taskResult(envelope({ summary: "implementation" }), "codex:generator");
        return taskResult(envelope({ summary: "accepted", verdict: "PASS" }), "codex:evaluator");
      }),
    };
    const manager = new AgentRunManager({
      taskId: "task-managed-runtime",
      cwd: tmp,
      provider: "codex",
      reporter: new TaskReporter("task-managed-runtime"),
      channel: fakeChannel() as never,
      policy: {
        maxMessages: 12,
        maxArtifactBytes: 3456,
        maxPingPongTurns: 4,
      },
    });

    const result = await manager.runManagedRuntime({
      prompt: "managed runtime task",
      runtime,
      signal: new AbortController().signal,
      onViewEvent: () => undefined,
    });

    expect(result.success).toBe(true);
    expect(childInputs).toHaveLength(3);
    expect(childInputs[0]?.prompt).toContain("MiniClaw live Agent Bus MCP tools are available");
    expect(childInputs[0]?.managedContext).toMatchObject({
      taskId: "task-managed-runtime",
      role: "planner",
      agentBusMcp: {
        serverName: "miniclaw-agent-bus",
        allowedTools: expect.arrayContaining(["mcp__miniclaw-agent-bus__post_message"]),
        serverConfig: {
          command: "pnpm",
          env: {
            MINICLAW_AGENT_BUS_TASK_ID: "task-managed-runtime",
            MINICLAW_AGENT_RUN_MANAGER_MAX_MESSAGES: "12",
            MINICLAW_AGENT_RUN_MANAGER_MAX_ARTIFACT_BYTES: "3456",
            MINICLAW_AGENT_RUN_MANAGER_MAX_PING_PONG_TURNS: "4",
          },
        },
      },
    });
    expect(childInputs.map((input) => input.managedContext?.role)).toEqual(["planner", "generator", "evaluator"]);
  });

  it("applies policy guardrails before spawning child runs beyond max turns", async () => {
    const runtime = fakeRuntime([
      taskResult(envelope({ summary: "planner ready" }), "codex:planner"),
    ]);
    const manager = new AgentRunManager({
      taskId: "task-managed-runtime",
      cwd: tmp,
      provider: "codex",
      reporter: new TaskReporter("task-managed-runtime"),
      channel: fakeChannel() as never,
      policy: { maxTurns: 1 },
    });

    const result = await manager.runManagedRuntime({
      prompt: "managed runtime task",
      runtime,
      signal: new AbortController().signal,
      onViewEvent: () => undefined,
    });

    expect(result.success).toBe(false);
    expect(result.result).toContain("max_turns=1");
    expect(listRunsForTask("task-managed-runtime").map((run) => run.role)).toEqual(["supervisor", "planner"]);
    expect(listRunsForTask("task-managed-runtime").find((run) => run.role === "supervisor")?.status).toBe("failed");
    expect(getAgentSchedulerState("task-managed-runtime")).toMatchObject({ status: "failed" });
  });

  it("times out managed child runs with a controlled failure", async () => {
    const runtime: AgentRuntime = {
      id: "codex",
      kind: "coding_agent",
      capabilities: { resumeSession: true, cancel: true, toolEvents: true, workspaceWrite: true },
      startTask: vi.fn(async (input) => {
        await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve(), { once: true }));
        return taskResult("aborted", "codex:timeout", false);
      }),
    };
    const manager = new AgentRunManager({
      taskId: "task-managed-runtime",
      cwd: tmp,
      provider: "codex",
      reporter: new TaskReporter("task-managed-runtime"),
      channel: fakeChannel() as never,
      policy: { timeoutMs: 5 },
    });

    const result = await manager.runManagedRuntime({
      prompt: "managed runtime task",
      runtime,
      signal: new AbortController().signal,
      onViewEvent: () => undefined,
    });

    expect(result.success).toBe(false);
    expect(result.result).toContain("planner timed out after 5ms");
    expect(listRunsForTask("task-managed-runtime").find((run) => run.role === "planner")?.status).toBe("failed");
  });

  it("cascades root cancellation into active child runs", async () => {
    let childInput: AgentTaskInput | undefined;
    let childStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { childStarted = resolve; });
    const runtime: AgentRuntime = {
      id: "codex",
      kind: "coding_agent",
      capabilities: { resumeSession: true, cancel: true, toolEvents: true, workspaceWrite: true },
      startTask: vi.fn(async (input) => {
        childInput = input;
        childStarted?.();
        await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve(), { once: true }));
        return taskResult("cancelled", "codex:cancelled", false);
      }),
    };
    const ctrl = new AbortController();
    const manager = new AgentRunManager({
      taskId: "task-managed-runtime",
      cwd: tmp,
      provider: "codex",
      reporter: new TaskReporter("task-managed-runtime"),
      channel: fakeChannel() as never,
    });

    const resultPromise = manager.runManagedRuntime({
      prompt: "managed runtime task",
      runtime,
      signal: ctrl.signal,
      onViewEvent: () => undefined,
    });
    await started;
    expect(childInput).toBeDefined();
    ctrl.abort(new Error("operator cancelled"));
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.result).toContain("取消");
    expect(listRunsForTask("task-managed-runtime").map((run) => run.status)).toEqual(["cancelled", "cancelled"]);
  });
});
