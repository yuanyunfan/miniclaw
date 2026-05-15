import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDb } from "../../../store/connection.js";
import { ensureBaseSchema, runMigrations } from "../../../store/schema.js";
import { createTask } from "../../../store/repositories/tasks.js";
import { createRun, getMessage } from "../../../store/agent-run-manager.js";
import { AgentBus } from "../bus.js";

let db: Database.Database;
let tmp: string;

beforeEach(() => {
  db = new Database(":memory:");
  ensureBaseSchema(db);
  runMigrations(db);
  setDb(db);
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-agent-bus-"));
  createTask({
    id: "task-bus",
    discord_thread_id: "thread-bus",
    discord_user_id: "user-1",
    prompt: "bus test",
    cwd: tmp,
  });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function makeRun(id: string, role: string, canSendKinds: string[], canReceiveKinds: string[]) {
  return createRun({
    id,
    taskId: "task-bus",
    role,
    runtime: "fake",
    controlScope: role === "supervisor" ? "root" : "child",
    cwd: tmp,
    toolPolicyId: "test",
    canSendKinds,
    canReceiveKinds,
  });
}

describe("AgentBus", () => {
  it("delivers direct messages to waiters without SQLite polling loops", async () => {
    const researcher = makeRun("run-researcher", "researcher", ["finding"], ["question"]);
    const planner = makeRun("run-planner", "planner", ["question"], ["finding"]);
    const bus = new AgentBus();

    const waiter = bus.waitForMessage({
      runId: planner.id,
      kinds: ["finding"],
      timeoutMs: 500,
    });

    const sent = bus.sendMessage({
      taskId: "task-bus",
      fromRunId: researcher.id,
      toRunId: planner.id,
      kind: "finding",
      contentText: "Codex needs managed child threads.",
      payload: { evidence: ["src/agent/runners/codex-task-runner.ts"] },
    });

    await expect(waiter).resolves.toMatchObject({
      id: sent.id,
      kind: "finding",
      content_text: "Codex needs managed child threads.",
    });
    expect(getMessage(sent.id)?.delivered_at).toBeTruthy();
    expect(bus.readMailbox({ runId: planner.id }).map((message) => message.id)).toEqual([sent.id]);
  });

  it("enforces send and receive kind policies", () => {
    const generator = makeRun("run-generator", "generator", ["artifact"], ["handoff"]);
    const evaluator = makeRun("run-evaluator", "evaluator", ["verdict"], ["artifact"]);
    const bus = new AgentBus();

    expect(() =>
      bus.sendMessage({
        taskId: "task-bus",
        fromRunId: generator.id,
        toRunId: evaluator.id,
        kind: "question",
        contentText: "should fail",
      })
    ).toThrow(/cannot send question/);
  });
});
