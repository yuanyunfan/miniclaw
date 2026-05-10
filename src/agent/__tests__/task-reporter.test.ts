import { beforeAll, describe, expect, it } from "vitest";
import { v4 as uuid } from "uuid";
import { TaskReporter } from "../task-reporter.js";
import { createTask, initDb } from "../../store/db.js";
import { listTaskEvents } from "../../store/task-events.js";

beforeAll(() => {
  initDb();
});

function makeTask(): string {
  const id = uuid();
  createTask({
    id,
    discord_thread_id: "thread-" + id.slice(0, 8),
    discord_user_id: "user-1",
    prompt: "report task events",
    cwd: "/tmp",
  });
  return id;
}

describe("TaskReporter", () => {
  it("persists compact lifecycle and error events", () => {
    const taskId = makeTask();
    const reporter = new TaskReporter(taskId);

    reporter.accepted({ route: "slash_command", cwd: "/tmp" });
    reporter.providerError("codex", "x".repeat(700), { event_type: "turn.failed" });
    reporter.finished("failed", { provider: "codex", duration_ms: 10 });

    const rows = listTaskEvents(taskId, 10);
    expect(rows.map((row) => row.event_type)).toEqual([
      "task_finished",
      "provider_error",
      "task_accepted",
    ]);
    expect(rows[1]?.message?.length).toBeLessThanOrEqual(500);
    expect(rows[1]?.severity).toBe("error");
  });
});
