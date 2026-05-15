import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDb } from "../../../store/connection.js";
import {
  appendMessage,
  createRun,
  getAgentSchedulerState,
  getRun,
  listRunsForTask,
  updateRunStatus,
  upsertAgentSchedulerState,
  upsertBlackboardFact,
  writeArtifact,
} from "../../../store/agent-run-manager.js";
import { createTask } from "../../../store/repositories/tasks.js";
import { ensureBaseSchema, runMigrations } from "../../../store/schema.js";
import { runAgentRunManagerSweep } from "../sweeper.js";

const NOW = new Date("2026-05-15T00:00:00.000Z");
const OLD = "2026-05-14T00:00:00.000Z";
const RECENT = "2026-05-15T00:00:00.000Z";
const NO_CLEANUP_POLICY = {
  timeoutMs: 10_000,
  cleanupTtlMs: 30 * 24 * 60 * 60 * 1000,
};

let db: Database.Database;
let tmp: string;

beforeEach(() => {
  db = new Database(":memory:");
  ensureBaseSchema(db);
  runMigrations(db);
  setDb(db);
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-agent-sweeper-"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function countRows(table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: number };
  return Number(row.count ?? 0);
}

function insertTask(id: string): void {
  createTask({
    id,
    discord_thread_id: `thread-${id}`,
    discord_user_id: "user-1",
    prompt: `managed task ${id}`,
    cwd: tmp,
  });
}

function createRoot(taskId: string, id = `${taskId}-root`) {
  return createRun({
    id,
    taskId,
    role: "supervisor",
    runtime: "fake",
    controlScope: "root",
    cwd: tmp,
    toolPolicyId: "supervisor",
    canSpawn: true,
    canSendKinds: ["handoff", "finding", "artifact", "verdict"],
    canReceiveKinds: ["handoff", "finding", "artifact", "verdict"],
  });
}

function createChild(taskId: string, parentRunId: string, id = `${taskId}-child`) {
  return createRun({
    id,
    taskId,
    parentRunId,
    controllerRunId: parentRunId,
    requesterRunId: parentRunId,
    role: "generator",
    runtime: "fake",
    controlScope: "child",
    cwd: tmp,
    toolPolicyId: "workspace-write",
    canWriteWorkspace: true,
    canSendKinds: ["artifact", "finding"],
    canReceiveKinds: ["handoff"],
    spawnDepth: 1,
  });
}

function ageRun(id: string, timestamp: string): void {
  db.prepare(
    `UPDATE agent_runs
     SET started_at = @ts,
         completed_at = CASE
           WHEN status IN ('completed', 'failed', 'cancelled') THEN @ts
           ELSE completed_at
         END
     WHERE id = @id`
  )
    .run({ id, ts: timestamp });
}

describe("Agent Run Manager sweeper", () => {
  it("fails stale active runs and waiting scheduler state after timeout", () => {
    insertTask("task-stale");
    const root = createRoot("task-stale");
    const child = createChild("task-stale", root.id);
    upsertAgentSchedulerState({
      taskId: "task-stale",
      rootRunId: root.id,
      schedulerVersion: "managed-runtime-v1",
      status: "waiting",
      currentStep: "generator",
      waitRunId: root.id,
      waitKinds: ["artifact"],
      plan: { nodes: [{ id: "generator" }] },
    });
    ageRun(root.id, OLD);
    ageRun(child.id, OLD);
    db.prepare("UPDATE agent_scheduler_state SET updated_at = @old WHERE task_id = 'task-stale'").run({ old: OLD });

    const report = runAgentRunManagerSweep({ now: NOW, policy: NO_CLEANUP_POLICY });

    expect(report.actions.map((action) => action.type)).toContain("scheduler_timed_out");
    expect(getRun(root.id)?.status).toBe("failed");
    expect(getRun(child.id)?.status).toBe("failed");
    expect(getAgentSchedulerState("task-stale")?.status).toBe("failed");
  });

  it("closes orphan child runs and cancels children of a cancelled parent", () => {
    insertTask("task-orphans");
    insertTask("task-foreign-parent");
    const root = createRoot("task-orphans");
    const cancelledChild = createChild("task-orphans", root.id, "child-cancelled-parent");
    const foreignParent = createRoot("task-foreign-parent", "foreign-parent");
    const orphan = createChild("task-orphans", foreignParent.id, "child-foreign-parent");
    ageRun(cancelledChild.id, RECENT);
    ageRun(orphan.id, RECENT);
    updateRunStatus(root.id, "cancelled", { errorMessage: "operator cancelled" });

    const report = runAgentRunManagerSweep({ now: NOW, policy: NO_CLEANUP_POLICY });

    expect(report.actions.map((action) => action.type)).toEqual(expect.arrayContaining([
      "cancelled_parent_child_cancelled",
      "orphan_child_failed",
    ]));
    expect(getRun(cancelledChild.id)?.status).toBe("cancelled");
    expect(getRun(orphan.id)?.status).toBe("failed");
  });

  it("recovers a waiting scheduler from a durable child event after restart", () => {
    insertTask("task-restart");
    const root = createRoot("task-restart");
    const child = createChild("task-restart", root.id);
    updateRunStatus(root.id, "waiting", { completedAt: null });
    updateRunStatus(child.id, "completed", { providerSessionId: "fake:child" });
    upsertAgentSchedulerState({
      taskId: "task-restart",
      rootRunId: root.id,
      schedulerVersion: "managed-runtime-v1",
      status: "waiting",
      currentStep: "generator",
      waitRunId: root.id,
      waitKinds: ["artifact"],
      plan: { nodes: [{ id: "generator" }] },
    });
    const message = appendMessage({
      taskId: "task-restart",
      fromRunId: child.id,
      toRunId: root.id,
      kind: "artifact",
      contentText: "artifact ready",
    });

    const report = runAgentRunManagerSweep({ now: NOW, policy: NO_CLEANUP_POLICY });

    expect(report.actions).toContainEqual(expect.objectContaining({
      type: "scheduler_recovered_from_message",
      messageId: message.id,
    }));
    expect(getRun(root.id)?.status).toBe("running");
    expect(getAgentSchedulerState("task-restart")).toMatchObject({
      status: "running",
      last_message_id: message.id,
    });
  });

  it("dry-runs cleanup and executes TTL cleanup without deleting external artifact refs", () => {
    insertTask("task-cleanup");
    const root = createRoot("task-cleanup");
    const child = createChild("task-cleanup", root.id);
    const managerArtifact = writeArtifact({
      taskId: "task-cleanup",
      runId: child.id,
      kind: "markdown",
      cwd: tmp,
      title: "manager artifact",
      content: "# artifact\n",
    });
    const externalPath = join(tmp, "notes", "user.md");
    mkdirSync(join(tmp, "notes"), { recursive: true });
    writeFileSync(externalPath, "keep this user workspace file", "utf8");
    writeArtifact({
      id: "external-ref",
      taskId: "task-cleanup",
      runId: child.id,
      kind: "file_ref",
      cwd: tmp,
      path: "notes/user.md",
      title: "external file",
    });
    const message = appendMessage({
      taskId: "task-cleanup",
      fromRunId: child.id,
      toRunId: root.id,
      kind: "artifact",
      contentText: "done",
    });
    upsertBlackboardFact({
      taskId: "task-cleanup",
      key: "verdict",
      content: "PASS",
      sourceMessageId: message.id,
      confidence: "high",
    });
    updateRunStatus(child.id, "completed");
    updateRunStatus(root.id, "completed");
    ageRun(root.id, OLD);
    ageRun(child.id, OLD);

    const dryRun = runAgentRunManagerSweep({
      now: NOW,
      policy: { ...NO_CLEANUP_POLICY, cleanupTtlMs: 1_000 },
      dryRun: true,
    });

    expect(dryRun.cleanup.candidateTaskIds).toEqual(["task-cleanup"]);
    expect(dryRun.cleanup.managerOwnedArtifactCount).toBe(1);
    expect(dryRun.cleanup.externalArtifactRefCount).toBe(1);
    expect(countRows("agent_runs")).toBe(2);

    const applied = runAgentRunManagerSweep({
      now: NOW,
      policy: { ...NO_CLEANUP_POLICY, cleanupTtlMs: 1_000 },
    });

    expect(applied.cleanup.deletedRows.runs).toBe(2);
    expect(existsSync(join(tmp, managerArtifact.path))).toBe(false);
    expect(existsSync(externalPath)).toBe(true);
    expect(listRunsForTask("task-cleanup")).toEqual([]);
    expect(countRows("agent_messages")).toBe(0);
    expect(countRows("agent_artifacts")).toBe(0);
    expect(countRows("blackboard_facts")).toBe(0);
  });
});
