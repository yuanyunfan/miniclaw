import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { v4 as uuid } from "uuid";
import {
  SCHEMA_VERSION,
  initDb,
  createTask,
  getTask,
  getTaskByThreadId,
  updateTask,
  markTaskInterrupted,
  getInterruptedTasks,
  getSchemaVersion,
  recordSmartRouterDecision,
  updateSmartRouterDecision,
  getRecentSmartRouterDecisions,
  __testables,
} from "../db.js";

beforeAll(() => {
  initDb();
});

afterAll(() => {
  // tmp dir cleanup is OS responsibility; we just disconnect.
});

function makeTask(threadId = "thread-" + uuid().slice(0, 8)) {
  const id = uuid();
  createTask({
    id,
    discord_thread_id: threadId,
    discord_user_id: "u-1",
    prompt: "test prompt",
    cwd: "/tmp",
  });
  return { id, threadId };
}

describe("createTask + getTask", () => {
  it("inserts and retrieves a task", () => {
    const { id } = makeTask();
    const row = getTask(id);
    expect(row).toBeDefined();
    expect(row?.prompt).toBe("test prompt");
    expect(row?.status).toBe("running");
  });

  it("returns undefined for unknown id", () => {
    expect(getTask("nonexistent-id")).toBeUndefined();
  });

  it("persists optional source metadata and parent context", () => {
    const id = uuid();
    const source = {
      provider: "discord",
      route_type: "task_channel",
      source_channel_id: "channel-1",
      source_message_id: "message-1",
    };
    const parent = {
      kind: "reply",
      provider: "discord",
      message_id: "parent-1",
      content: "parent message",
    };
    createTask({
      id,
      discord_thread_id: "thread-context",
      discord_user_id: "u-1",
      prompt: "test prompt",
      cwd: "/tmp",
      source_route_type: "task_channel",
      source_channel_id: "channel-1",
      source_message_id: "message-1",
      source_message_url: "https://discord.com/channels/guild/channel/message",
      source_metadata_json: JSON.stringify(source),
      parent_context_json: JSON.stringify(parent),
    });

    const row = getTask(id);
    expect(row?.source_route_type).toBe("task_channel");
    expect(row?.source_channel_id).toBe("channel-1");
    expect(row?.source_message_id).toBe("message-1");
    expect(row?.source_message_url).toContain("discord.com");
    expect(JSON.parse(row?.source_metadata_json ?? "{}")).toMatchObject(source);
    expect(JSON.parse(row?.parent_context_json ?? "{}")).toMatchObject(parent);
  });
});

describe("schema migrations", () => {
  it("sets SQLite user_version to current schema version", () => {
    expect(getSchemaVersion()).toBe(SCHEMA_VERSION);
  });

  it("ensures progress_message_id column exists", () => {
    expect(__testables.columnExists("tasks", "progress_message_id")).toBe(true);
  });

  it("ensures smart router decisions table exists", () => {
    expect(__testables.columnExists("smart_router_decisions", "prompt_hash")).toBe(true);
    expect(__testables.columnExists("smart_router_decisions", "action_result")).toBe(true);
  });

  it("ensures task source context columns exist", () => {
    expect(__testables.columnExists("tasks", "source_route_type")).toBe(true);
    expect(__testables.columnExists("tasks", "source_channel_id")).toBe(true);
    expect(__testables.columnExists("tasks", "source_message_id")).toBe(true);
    expect(__testables.columnExists("tasks", "source_message_url")).toBe(true);
    expect(__testables.columnExists("tasks", "source_metadata_json")).toBe(true);
    expect(__testables.columnExists("tasks", "parent_context_json")).toBe(true);
  });
});

describe("updateTask", () => {
  it("updates allowed fields", () => {
    const { id } = makeTask();
    updateTask(id, { session_id: "sess-abc", status: "completed", cost_usd: 0.42 });
    const row = getTask(id);
    expect(row?.session_id).toBe("sess-abc");
    expect(row?.status).toBe("completed");
    expect(row?.cost_usd).toBe(0.42);
  });
});

describe("getTaskByThreadId", () => {
  it("returns most recent task with session_id for thread", () => {
    const threadId = "thread-multi-" + uuid().slice(0, 6);
    const t1 = makeTask(threadId);
    updateTask(t1.id, { session_id: "sess-old" });
    const t2 = makeTask(threadId);
    updateTask(t2.id, { session_id: "sess-new" });
    const row = getTaskByThreadId(threadId);
    expect(row).toBeDefined();
    expect(row?.session_id).toBe("sess-new");
  });

  it("ignores tasks without session_id", () => {
    const threadId = "thread-nosess-" + uuid().slice(0, 6);
    makeTask(threadId); // no session_id assigned
    expect(getTaskByThreadId(threadId)).toBeUndefined();
  });

  it("returns undefined for unknown thread", () => {
    expect(getTaskByThreadId("never-existed")).toBeUndefined();
  });
});

describe("markTaskInterrupted + getInterruptedTasks", () => {
  it("flips status from running to interrupted", () => {
    const { id } = makeTask();
    markTaskInterrupted(id, "shutdown drain timeout");
    expect(getTask(id)?.status).toBe("interrupted");
    expect(getTask(id)?.result_summary).toBe("shutdown drain timeout");
    const interrupted = getInterruptedTasks(20);
    expect(interrupted.some((t) => t.id === id)).toBe(true);
  });
});

describe("smart router decisions", () => {
  it("records redacted decisions and updates action result", () => {
    const id = recordSmartRouterDecision({
      message_id: "msg-1",
      channel_id: "ch-1",
      user_id: "user-1",
      prompt_hash: "hash-1",
      prompt_preview: "修复 README 并跑测试",
      intent: "task_confirm",
      confidence: 0.88,
      reason: "strong task signal",
      matched_signals: ["modify", "validation"],
      risk_flags: ["writes_files", "runs_tests"],
      action_result: "confirmation_pending",
    });

    updateSmartRouterDecision(id, {
      action_result: "confirmed_task_created",
      created_task_id: "task-1",
    });

    const row = getRecentSmartRouterDecisions(5).find((r) => r.id === id);
    expect(row).toBeDefined();
    expect(row?.prompt_preview).toBe("修复 README 并跑测试");
    expect(row?.full_prompt).toBeNull();
    expect(row?.action_result).toBe("confirmed_task_created");
    expect(row?.created_task_id).toBe("task-1");
    expect(JSON.parse(row?.matched_signals ?? "[]")).toEqual(["modify", "validation"]);
  });
});
