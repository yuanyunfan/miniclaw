import { beforeAll, describe, expect, it } from "vitest";
import { v4 as uuid } from "uuid";
import { createTask, initDb } from "../db.js";
import { appendTaskEvent, countTaskEvents, listTaskEvents } from "../task-events.js";

beforeAll(() => {
  initDb();
});

function makeTask(): string {
  const id = uuid();
  createTask({
    id,
    discord_thread_id: "thread-" + id.slice(0, 8),
    discord_user_id: "user-1",
    prompt: "trace this task",
    cwd: "/tmp",
  });
  return id;
}

describe("task events store", () => {
  it("appends, lists, and counts normalized task trace events", () => {
    const taskId = makeTask();

    const first = appendTaskEvent({
      taskId,
      eventType: "task_started",
      payload: { provider: "codex" },
    });
    const second = appendTaskEvent({
      taskId,
      eventType: "provider_error",
      severity: "error",
      message: "TypeError: boom",
      payload: { provider: "codex", event_type: "turn.failed" },
    });

    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(countTaskEvents(taskId)).toBe(2);

    const rows = listTaskEvents(taskId, 10);
    expect(rows.map((row) => row.event_type)).toEqual(["provider_error", "task_started"]);
    expect(rows[0]).toMatchObject({
      task_id: taskId,
      severity: "error",
      message: "TypeError: boom",
    });
    expect(JSON.parse(rows[0]?.payload_json ?? "{}")).toMatchObject({ provider: "codex" });
  });
});
