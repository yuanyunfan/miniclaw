import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentRuntime } from "../../runtime/agent-runtime.js";

const ENV_KEYS = [
  "DISCORD_TOKEN",
  "MINICLAW_CONFIG",
  "MINICLAW_AGENT_PROVIDER",
  "MINICLAW_E2E_MODE",
  "MINICLAW_E2E_FAKE_AGENT",
] as const;

const mocks = vi.hoisted(() => ({
  getDefaultAgentRuntime: vi.fn(),
  startTask: vi.fn(),
}));

vi.mock("../runtimes/registry.js", async () => {
  const actual = await vi.importActual<typeof import("../runtimes/registry.js")>("../runtimes/registry.js");
  return {
    ...actual,
    getDefaultAgentRuntime: mocks.getDefaultAgentRuntime,
  };
});

let tmp: string;
let previousEnv: Record<string, string | undefined>;

function fakeChannel() {
  const sent: string[] = [];
  return {
    sent,
    channel: {
      send: async (payload: unknown) => {
        const content = typeof payload === "string"
          ? payload
          : payload && typeof payload === "object" && "content" in payload
            ? String((payload as { content?: unknown }).content ?? "")
            : "";
        sent.push(content);
        return {
          id: `message-${sent.length}`,
          content,
          edit: async (next: unknown) => {
            sent.push(typeof next === "string" ? next : JSON.stringify(next));
          },
          delete: async () => undefined,
        };
      },
    },
  };
}

function configuredRuntime(): AgentRuntime {
  return {
    id: "codex",
    kind: "coding_agent",
    capabilities: {
      resumeSession: true,
      cancel: true,
      toolEvents: true,
      workspaceWrite: true,
    },
    startTask: mocks.startTask,
  };
}

beforeEach(() => {
  vi.resetModules();
  mocks.getDefaultAgentRuntime.mockReset();
  mocks.startTask.mockReset();

  tmp = mkdtempSync(join(tmpdir(), "miniclaw-task-runtime-registry-"));
  previousEnv = {};
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key];
    delete process.env[key];
  }

  const cfg = join(tmp, "config.yaml");
  writeFileSync(cfg, `
discord:
  token: "test-token"
  client_id: "test-client"
  guild_id: "test-guild"
  allowed_user_id: "test-user"
agent:
  provider: codex
  default_cwd: "${tmp}"
storage:
  db_path: "${join(tmp, "data.db")}"
  memory_path: "${join(tmp, "MEMORY.md")}"
`);
  process.env.MINICLAW_CONFIG = cfg;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = previousEnv[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  rmSync(tmp, { recursive: true, force: true });
  vi.resetModules();
});

describe("executeTask runtime registry wiring", () => {
  it("starts task execution through the selected AgentRuntime", async () => {
    const runtimeResult = {
      success: true,
      sessionId: "codex:sess-registry",
      costUsd: 0,
      durationMs: 25,
      turns: 1,
      result: "runtime registry ok",
      progressLines: ["runtime step"],
      toolCount: 1,
    };
    mocks.getDefaultAgentRuntime.mockReturnValue(configuredRuntime());
    mocks.startTask.mockResolvedValue(runtimeResult);

    const { createTask, getTask, initDb } = await import("../../store/db.js");
    const { executeTask } = await import("../task.js");
    initDb();
    createTask({
      id: "task-runtime-registry",
      discord_thread_id: "thread-runtime-registry",
      discord_user_id: "test-user",
      prompt: "run through runtime registry",
      cwd: tmp,
    });

    const { channel, sent } = fakeChannel();
    const result = await executeTask({
      taskId: "task-runtime-registry",
      prompt: "run through runtime registry",
      cwd: tmp,
      channel: channel as never,
      resumeSessionId: "codex:previous-session",
      attachmentBlocks: [{ type: "text", text: "anthropic attachment" }],
      attachmentCodexInputs: [{ type: "text", text: "codex attachment" }],
      outputMode: "raw",
    });

    expect(mocks.getDefaultAgentRuntime).toHaveBeenCalledWith(expect.objectContaining({
      agentProvider: "codex",
    }));
    expect(mocks.startTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-runtime-registry",
      prompt: "run through runtime registry",
      cwd: tmp,
      resumeSessionId: "codex:previous-session",
      attachments: {
        contentBlocks: [{ type: "text", text: "anthropic attachment" }],
        inputEntries: [{ type: "text", text: "codex attachment" }],
      },
      signal: expect.any(AbortSignal),
      onViewEvent: expect.any(Function),
      onTraceEvent: expect.any(Function),
    }));
    expect(result).toBe(runtimeResult);
    expect(getTask("task-runtime-registry")).toMatchObject({
      status: "completed",
      session_id: "codex:sess-registry",
      result_summary: "runtime registry ok",
    });
    expect(sent).toContain("runtime registry ok");
  });

  it("can execute with an IM task view reporter and no Discord channel", async () => {
    const runtimeResult = {
      success: true,
      sessionId: "codex:sess-im",
      costUsd: 0,
      durationMs: 12,
      turns: 1,
      result: "im reporter ok",
      progressLines: ["im step"],
      toolCount: 1,
    };
    mocks.getDefaultAgentRuntime.mockReturnValue(configuredRuntime());
    mocks.startTask.mockResolvedValue(runtimeResult);

    const { createTask, initDb } = await import("../../store/db.js");
    const { executeTask } = await import("../task.js");
    initDb();
    createTask({
      id: "task-im-reporter",
      discord_thread_id: "weixin:acct:task-im-reporter",
      discord_user_id: "weixin:user",
      prompt: "run through im reporter",
      cwd: tmp,
    });

    const viewReporter = {
      start: vi.fn(async () => undefined),
      handle: vi.fn(async () => undefined),
      snapshot: vi.fn(() => ({ lines: ["snapshot step"], turns: 1, toolCount: 1 })),
      finish: vi.fn(async () => undefined),
      renderTaskError: vi.fn(async () => undefined),
    };

    const result = await executeTask({
      taskId: "task-im-reporter",
      prompt: "run through im reporter",
      cwd: tmp,
      viewReporter,
    });

    expect(result).toBe(runtimeResult);
    expect(mocks.startTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-im-reporter",
      prompt: "run through im reporter",
      cwd: tmp,
      signal: expect.any(AbortSignal),
      onViewEvent: expect.any(Function),
      onTraceEvent: expect.any(Function),
    }));
    expect(viewReporter.start).toHaveBeenCalled();
    expect(viewReporter.finish).toHaveBeenCalledWith(runtimeResult, "completed", { lines: ["im step"], toolCount: 1 });
  });
});
