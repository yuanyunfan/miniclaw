import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ENV_KEYS = [
  "MINICLAW_CONFIG",
  "MINICLAW_E2E_MODE",
  "MINICLAW_E2E_FAKE_AGENT",
  "MINICLAW_E2E_SENDER_USER_IDS",
  "MINICLAW_DISABLE_SCHEDULER",
] as const;

let tmp: string;
let previousEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.resetModules();
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-e2e-runtime-"));
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

describe("E2E fake runtime", () => {
  it("short-circuits chat through deterministic fake output and persists history", async () => {
    const { initDb, getChatHistory } = await import("../../store/db.js");
    const { chat } = await import("../chat.js");
    initDb();

    const reply = await chat("channel-1", "test-user", "e2e chat runtime-1");

    expect(reply).toBe("E2E_CHAT_OK runtime-1");
    expect(getChatHistory("channel-1", 10).map((row) => row.content)).toEqual([
      "E2E_CHAT_OK runtime-1",
      "e2e chat runtime-1",
    ]);
  });

  it("short-circuits task execution through deterministic fake output and updates DB", async () => {
    const sent: string[] = [];
    const fakeChannel = {
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
    };
    const { createTask, getTask, initDb } = await import("../../store/db.js");
    const { executeTask } = await import("../task.js");
    initDb();
    createTask({
      id: "task-runtime-1",
      discord_thread_id: "thread-1",
      discord_user_id: "test-user",
      prompt: "e2e task runtime-1",
      cwd: tmp,
    });

    const result = await executeTask({
      taskId: "task-runtime-1",
      prompt: "e2e task runtime-1",
      cwd: tmp,
      channel: fakeChannel as never,
    });

    expect(result).toMatchObject({
      success: true,
      result: "E2E_TASK_OK runtime-1",
      sessionId: "codex:e2e-runtime-1",
      turns: 1,
    });
    expect(getTask("task-runtime-1")).toMatchObject({
      status: "completed",
      result_summary: "E2E_TASK_OK runtime-1",
      session_id: "codex:e2e-runtime-1",
    });
    expect(sent.some((message) => message.includes("E2E_TASK_OK runtime-1"))).toBe(true);
  });
});
