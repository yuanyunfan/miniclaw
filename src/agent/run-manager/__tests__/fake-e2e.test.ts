import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const E2E_STYLE_TEST_TIMEOUT_MS = 15_000;

const ENV_KEYS = [
  "MINICLAW_CONFIG",
  "MINICLAW_E2E_MODE",
  "MINICLAW_E2E_FAKE_AGENT",
  "MINICLAW_E2E_SENDER_USER_IDS",
  "MINICLAW_DISABLE_SCHEDULER",
  "MINICLAW_AGENT_RUN_MANAGER_ENABLED",
  "MINICLAW_AGENT_RUN_MANAGER_MAX_TURNS",
  "MINICLAW_AGENT_RUN_MANAGER_TIMEOUT_MS",
  "MINICLAW_AGENT_RUN_MANAGER_CHILD_TIMEOUT_MS",
  "MINICLAW_AGENT_RUN_MANAGER_MAX_MESSAGES",
  "MINICLAW_AGENT_RUN_MANAGER_MAX_ARTIFACT_BYTES",
  "MINICLAW_AGENT_RUN_MANAGER_MAX_SPAWN_DEPTH",
  "MINICLAW_AGENT_RUN_MANAGER_MAX_CHILDREN_PER_RUN",
  "MINICLAW_AGENT_RUN_MANAGER_MAX_CONCURRENT_RUNS",
  "MINICLAW_AGENT_RUN_MANAGER_MAX_PING_PONG_TURNS",
  "MINICLAW_AGENT_RUN_MANAGER_CLEANUP_TTL_MS",
  "MINICLAW_AGENT_RUN_MANAGER_MAX_FIX_ITERATIONS",
] as const;

let tmp: string;
let previousEnv: Record<string, string | undefined>;

function fakeChannel() {
  const sent: string[] = [];
  return {
    sent,
    channel: {
      id: "channel-agent-manager",
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

beforeEach(() => {
  vi.resetModules();
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-agent-manager-e2e-"));
  previousEnv = {};
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key];
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
agent_run_manager:
  enabled: true
storage:
  db_path: "${join(tmp, "data.db")}"
  memory_path: "${join(tmp, "MEMORY.md")}"
e2e:
  mode: true
  sender_user_ids: ["test-user"]
  disable_scheduler: true
  fake_agent: true
`);
  process.env.MINICLAW_CONFIG = cfg;
  process.env.MINICLAW_E2E_MODE = "true";
  process.env.MINICLAW_E2E_FAKE_AGENT = "true";
  process.env.MINICLAW_E2E_SENDER_USER_IDS = "test-user";
  process.env.MINICLAW_DISABLE_SCHEDULER = "true";
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

describe("Agent Run Manager fake E2E", () => {
  it("runs planner -> generator -> evaluator and persists collaboration state", async () => {
    const { createTask, initDb } = await import("../../../store/db.js");
    const { listTaskEvents } = await import("../../../store/task-events.js");
    const {
      listActiveFacts,
      listArtifactsForRun,
      listRunsForTask,
      readMailbox,
    } = await import("../../../store/agent-run-manager.js");
    const { executeTask } = await import("../../task.js");
    initDb();
    createTask({
      id: "task-manager-e2e",
      discord_thread_id: "thread-manager-e2e",
      discord_user_id: "test-user",
      prompt: "agent run manager fake e2e",
      cwd: tmp,
    });
    const { channel, sent } = fakeChannel();

    const result = await executeTask({
      taskId: "task-manager-e2e",
      prompt: "agent run manager fake e2e",
      cwd: tmp,
      channel: channel as never,
    });

    expect(result).toMatchObject({
      success: true,
      sessionId: expect.stringMatching(/^manager:/),
      result: expect.stringContaining("Agent Run Manager fake E2E completed"),
      turns: 3,
    });
    const runs = listRunsForTask("task-manager-e2e");
    expect(runs.map((run) => run.role).sort()).toEqual(["evaluator", "generator", "planner", "supervisor"]);
    expect(runs.every((run) => run.status === "completed")).toBe(true);
    expect(runs.find((run) => run.role === "supervisor")?.route).toMatchObject({
      discord_channel_id: "channel-agent-manager",
      discord_thread_id: "thread-manager-e2e",
      requester_user_id: "test-user",
      root_task_id: "task-manager-e2e",
    });

    const generator = runs.find((run) => run.role === "generator");
    const evaluator = runs.find((run) => run.role === "evaluator");
    expect(generator).toBeDefined();
    expect(evaluator).toBeDefined();
    expect(readMailbox({ runId: generator?.id ?? "" }).some((message) => message.kind === "handoff")).toBe(true);
    expect(listArtifactsForRun(generator?.id ?? "")).toHaveLength(1);
    expect(listActiveFacts("task-manager-e2e")).toEqual([
      expect.objectContaining({ key: "final_verdict", content: "PASS", confidence: "high" }),
    ]);

    const eventTypes = listTaskEvents("task-manager-e2e", 50).map((event) => event.event_type);
    expect(eventTypes).toContain("agent_run_started");
    expect(eventTypes).toContain("agent_message_posted");
    expect(eventTypes).toContain("artifact_written");
    expect(eventTypes).toContain("verdict_received");
    expect(sent.some((message) => message.includes("Agent Run Manager fake E2E completed"))).toBe(true);
  }, E2E_STYLE_TEST_TIMEOUT_MS);
});
