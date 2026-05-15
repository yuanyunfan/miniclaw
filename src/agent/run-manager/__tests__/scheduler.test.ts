import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDb } from "../../../store/connection.js";
import { ensureBaseSchema, runMigrations } from "../../../store/schema.js";
import { createTask } from "../../../store/repositories/tasks.js";
import {
  createRun,
  getAgentSchedulerState,
  getRun,
} from "../../../store/agent-run-manager.js";
import { TaskReporter } from "../../task-reporter.js";
import { AgentBus } from "../bus.js";
import { AgentRunScheduler, createManagedSchedulerPlan } from "../scheduler.js";

let db: Database.Database;
let tmp: string;

beforeEach(() => {
  db = new Database(":memory:");
  ensureBaseSchema(db);
  runMigrations(db);
  setDb(db);
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-agent-scheduler-"));
  createTask({
    id: "task-scheduler",
    discord_thread_id: "thread-scheduler",
    discord_user_id: "user-1",
    prompt: "scheduler task",
    cwd: tmp,
  });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function createRootAndChild() {
  const root = createRun({
    id: "run-root",
    taskId: "task-scheduler",
    role: "supervisor",
    runtime: "fake",
    controlScope: "root",
    cwd: tmp,
    toolPolicyId: "supervisor",
    canSpawn: true,
    canSendKinds: ["*"],
    canReceiveKinds: ["*"],
  });
  const child = createRun({
    id: "run-child",
    taskId: "task-scheduler",
    parentRunId: root.id,
    requesterRunId: root.id,
    controllerRunId: root.id,
    role: "researcher",
    runtime: "fake",
    controlScope: "child",
    cwd: tmp,
    toolPolicyId: "read-only",
    canSendKinds: ["finding"],
    canReceiveKinds: ["question"],
    spawnDepth: 1,
  });
  return { root, child };
}

describe("AgentRunScheduler", () => {
  it("persists waiting state and resumes from a direct bus child event without polling", async () => {
    const { root, child } = createRootAndChild();
    const bus = new AgentBus();
    const reporter = new TaskReporter("task-scheduler");
    const scheduler = new AgentRunScheduler({
      taskId: "task-scheduler",
      rootRun: root,
      bus,
      reporter,
      waitTimeoutMs: 1000,
      plan: createManagedSchedulerPlan(1),
    });
    scheduler.start("start");

    const result = await scheduler.yieldUntilChildEvent({
      currentStep: "researcher",
      childRunId: child.id,
      waitKinds: ["finding"],
      signal: new AbortController().signal,
      runChild: async () => {
        expect(getRun(root.id)?.status).toBe("waiting");
        expect(getAgentSchedulerState("task-scheduler")).toMatchObject({
          status: "waiting",
          current_step: "researcher",
          wait_run_id: root.id,
          wait_kinds: ["finding"],
        });
        bus.sendMessage({
          taskId: "task-scheduler",
          fromRunId: child.id,
          toRunId: root.id,
          kind: "finding",
          contentText: "research finding ready",
        });
        return "child-result";
      },
    });

    expect(result.result).toBe("child-result");
    expect(result.wakeMessage).toMatchObject({ from_run_id: child.id, kind: "finding" });
    expect(getRun(root.id)?.status).toBe("running");
    expect(getAgentSchedulerState("task-scheduler")).toMatchObject({
      status: "running",
      current_step: "researcher",
      last_message_id: result.wakeMessage?.id,
    });
  });

  it("cancels a waiting scheduler state when the root signal is aborted", async () => {
    const { root, child } = createRootAndChild();
    const bus = new AgentBus();
    const scheduler = new AgentRunScheduler({
      taskId: "task-scheduler",
      rootRun: root,
      bus,
      reporter: new TaskReporter("task-scheduler"),
      waitTimeoutMs: 1000,
      plan: createManagedSchedulerPlan(0),
    });
    const ctrl = new AbortController();
    const childEntered = vi.fn();
    scheduler.start("start");

    await expect(scheduler.yieldUntilChildEvent({
      currentStep: "researcher",
      childRunId: child.id,
      waitKinds: ["finding"],
      signal: ctrl.signal,
      runChild: async () => {
        childEntered();
        ctrl.abort(new Error("operator cancelled"));
        return "cancelled";
      },
    })).rejects.toThrow(/aborted/);

    expect(childEntered).toHaveBeenCalledOnce();
    expect(getAgentSchedulerState("task-scheduler")).toMatchObject({
      status: "cancelled",
      current_step: "cancelled",
    });
  });
});
