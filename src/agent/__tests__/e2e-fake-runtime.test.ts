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
  "MINICLAW_ACTIVE_CHAT_STATE_PATH",
] as const;

let tmp: string;
let previousEnv: Record<string, string | undefined>;

interface RecordedDiscordAction {
  type: "send" | "edit" | "delete";
  content?: string;
  embedTitles: string[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function payloadContent(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload;
  const content = asRecord(payload)?.content;
  if (content === undefined) return undefined;
  return String(content);
}

function embedTitle(embed: unknown): string | undefined {
  const record = asRecord(embed);
  const toJSON = record?.toJSON;
  const json = typeof toJSON === "function"
    ? asRecord((toJSON as () => unknown).call(embed))
    : asRecord(record?.data) ?? record;
  const title = json?.title;
  return typeof title === "string" ? title : undefined;
}

function recordDiscordAction(type: RecordedDiscordAction["type"], payload?: unknown): RecordedDiscordAction {
  const embeds = asRecord(payload)?.embeds;
  return {
    type,
    content: payloadContent(payload),
    embedTitles: Array.isArray(embeds) ? embeds.map(embedTitle).filter((title): title is string => Boolean(title)) : [],
  };
}

function createRecordedChannel(): { channel: { send: (payload: unknown) => Promise<unknown> }; actions: RecordedDiscordAction[] } {
  const actions: RecordedDiscordAction[] = [];
  let sendCount = 0;
  return {
    actions,
    channel: {
      send: async (payload: unknown) => {
        const action = recordDiscordAction("send", payload);
        actions.push(action);
        let content = action.content ?? "";
        return {
          id: `message-${++sendCount}`,
          get content() {
            return content;
          },
          edit: async (next: unknown) => {
            const editAction = recordDiscordAction("edit", next);
            actions.push(editAction);
            content = editAction.content ?? content;
          },
          delete: async () => {
            actions.push(recordDiscordAction("delete"));
          },
        };
      },
    },
  };
}

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
  process.env.MINICLAW_ACTIVE_CHAT_STATE_PATH = join(tmp, "active-chats.json");
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

  it("renders fake task progress, completion summary, status embed, and final markdown", async () => {
    const { actions, channel } = createRecordedChannel();
    const { createTask, getTask, initDb } = await import("../../store/db.js");
    const { executeTask } = await import("../task.js");
    initDb();
    createTask({
      id: "task-runtime-view-1",
      discord_thread_id: "thread-1",
      discord_user_id: "test-user",
      prompt: "e2e task runtime-view-1",
      cwd: tmp,
    });

    const result = await executeTask({
      taskId: "task-runtime-view-1",
      prompt: "e2e task runtime-view-1",
      cwd: tmp,
      channel: channel as never,
    });

    expect(result).toMatchObject({
      success: true,
      result: "E2E_TASK_OK runtime-view-1",
      sessionId: "codex:e2e-runtime-view-1",
      turns: 1,
    });
    expect(actions.some((action) => action.type === "send" && action.embedTitles.includes("🔵 任务执行中"))).toBe(true);

    const initialProgress = actions.find((action) => action.type === "send" && action.content?.startsWith("### Realtime Progress"));
    expect(initialProgress?.content).toContain("status: running");
    expect(initialProgress?.content).toContain("turns: 0");
    expect(initialProgress?.content).toContain("tools: 0");
    expect(initialProgress?.content).toContain("- waiting for SDK events");

    const completionSummary = actions.find((action) => action.type === "edit" && action.content?.startsWith("### Execution Summary"));
    expect(completionSummary?.content).toContain("status: completed");
    expect(completionSummary?.content).toContain("turns: 1");
    expect(completionSummary?.content).toContain("tools: 0");
    expect(completionSummary?.content).toContain("tokens: in=17 out=9 cacheR=0 cacheW=0");
    expect(completionSummary?.content).toContain("- 🧪 e2e fake agent");

    expect(actions.some((action) => action.type === "edit" && action.embedTitles.includes("✅ 任务完成"))).toBe(true);
    expect(actions.filter((action) => action.type === "send").map((action) => action.content)).toContain("E2E_TASK_OK runtime-view-1");
    expect(getTask("task-runtime-view-1")).toMatchObject({
      status: "completed",
      result_summary: "E2E_TASK_OK runtime-view-1",
      session_id: "codex:e2e-runtime-view-1",
      progress_message_id: "message-2",
    });
  });

  it("applies raw output transform only to the Discord display text", async () => {
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
    const { createTask, initDb } = await import("../../store/db.js");
    const { executeTask } = await import("../task.js");
    initDb();
    createTask({
      id: "task-runtime-2",
      discord_thread_id: "thread-1",
      discord_user_id: "test-user",
      prompt: "e2e task runtime-2",
      cwd: tmp,
    });

    const result = await executeTask({
      taskId: "task-runtime-2",
      prompt: "e2e task runtime-2",
      cwd: tmp,
      channel: fakeChannel as never,
      outputMode: "raw",
      rawOutputTextTransform: (text) => text.replace("E2E_TASK_OK", "DISPLAY_OK"),
    });

    expect(result.result).toBe("E2E_TASK_OK runtime-2");
    expect(sent).toContain("DISPLAY_OK runtime-2");
    expect(sent).not.toContain("E2E_TASK_OK runtime-2");
  });
});
