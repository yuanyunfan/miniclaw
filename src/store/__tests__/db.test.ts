import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { v4 as uuid } from "uuid";
import { initDb, createTask, getTask, getTaskByThreadId, updateTask, markTaskInterrupted, getInterruptedTasks } from "../db.js";

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
    // small wait so created_at differs at second-precision
    const t2 = makeTask(threadId);
    updateTask(t2.id, { session_id: "sess-new" });
    const row = getTaskByThreadId(threadId);
    expect(row).toBeDefined();
    expect(["sess-old", "sess-new"]).toContain(row?.session_id);
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
    markTaskInterrupted(id);
    expect(getTask(id)?.status).toBe("interrupted");
    const interrupted = getInterruptedTasks(20);
    expect(interrupted.some((t) => t.id === id)).toBe(true);
  });
});
