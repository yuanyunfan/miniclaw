import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDb } from "../connection.js";
import { ensureBaseSchema, runMigrations } from "../schema.js";
import { createTask } from "../repositories/tasks.js";
import {
  appendMessage,
  createRun,
  getMessage,
  listActiveChildren,
  listActiveFacts,
  listArtifactsForRun,
  listRunsForTask,
  readArtifact,
  readMailbox,
  updateRunStatus,
  upsertBlackboardFact,
  writeArtifact,
} from "../agent-run-manager.js";

let db: Database.Database;
let tmp: string;

beforeEach(() => {
  db = new Database(":memory:");
  ensureBaseSchema(db);
  runMigrations(db);
  setDb(db);
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-agent-run-store-"));
  createTask({
    id: "task-agent-runs",
    discord_thread_id: "thread-agent-runs",
    discord_user_id: "user-1",
    prompt: "managed multi-agent task",
    cwd: tmp,
  });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("Agent Run Manager store", () => {
  it("persists runs, messages, blackboard facts, and artifacts through typed APIs", async () => {
    const root = createRun({
      id: "run-root",
      taskId: "task-agent-runs",
      role: "supervisor",
      runtime: "fake",
      controlScope: "root",
      cwd: tmp,
      toolPolicyId: "supervisor",
      canSpawn: true,
      canSendKinds: ["handoff"],
      canReceiveKinds: ["verdict"],
      route: { discord_thread_id: "thread-agent-runs", requester_user_id: "user-1" },
    });
    const child = createRun({
      id: "run-child",
      taskId: "task-agent-runs",
      parentRunId: root.id,
      requesterRunId: root.id,
      controllerRunId: root.id,
      role: "generator",
      runtime: "fake",
      controlScope: "child",
      cwd: tmp,
      toolPolicyId: "workspace-write",
      canWriteWorkspace: true,
      canSendKinds: ["artifact"],
      canReceiveKinds: ["handoff"],
      spawnDepth: 1,
    });

    const artifact = writeArtifact({
      id: "artifact-1",
      taskId: "task-agent-runs",
      runId: child.id,
      kind: "markdown",
      cwd: tmp,
      title: "Implementation notes",
      content: "# Notes\n\nManaged output.",
      summary: "short notes",
    });
    const message = appendMessage({
      id: "message-1",
      taskId: "task-agent-runs",
      fromRunId: root.id,
      toRunId: child.id,
      kind: "handoff",
      contentText: "write artifact",
      artifactIds: [artifact.id],
      payload: { acceptance: ["artifact"] },
    });
    const fact = upsertBlackboardFact({
      id: "fact-1",
      taskId: "task-agent-runs",
      key: "plan",
      content: "generator writes artifact",
      sourceMessageId: message.id,
      confidence: "high",
    });

    expect(root.route).toMatchObject({ requester_user_id: "user-1" });
    expect(listRunsForTask("task-agent-runs").map((run) => run.id)).toEqual(["run-root", "run-child"]);
    expect(listActiveChildren(root.id).map((run) => run.id)).toEqual(["run-child"]);
    expect(readMailbox({ runId: child.id })).toHaveLength(1);
    expect(fact).toMatchObject({ key: "plan", status: "active" });
    expect(listActiveFacts("task-agent-runs")).toHaveLength(1);
    expect(listArtifactsForRun(child.id)).toHaveLength(1);
    expect(readArtifact(artifact.id, tmp)?.content).toContain("Managed output");
    await expect(readFile(join(tmp, artifact.path), "utf8")).resolves.toContain("Managed output");

    updateRunStatus(child.id, "completed", { providerSessionId: "fake:child" });
    expect(listActiveChildren(root.id)).toEqual([]);
  });

  it("rejects malformed messages, missing runs, and supports blackboard lifecycle states", () => {
    const root = createRun({
      id: "run-root",
      taskId: "task-agent-runs",
      role: "supervisor",
      runtime: "fake",
      controlScope: "root",
      cwd: tmp,
      toolPolicyId: "supervisor",
      canSendKinds: ["finding"],
      canReceiveKinds: ["finding"],
    });

    expect(() =>
      appendMessage({
        taskId: "task-agent-runs",
        fromRunId: "missing-run",
        kind: "finding",
        contentText: "missing",
      })
    ).toThrow(/Unknown sender/);
    expect(() =>
      appendMessage({
        taskId: "task-agent-runs",
        fromRunId: root.id,
        kind: "bad-kind" as never,
        contentText: "bad",
      })
    ).toThrow(/Invalid agent message kind/);

    const message = appendMessage({
      id: "message-lifecycle",
      taskId: "task-agent-runs",
      fromRunId: root.id,
      kind: "finding",
      contentText: "finding",
    });
    expect(getMessage(message.id)).toBeDefined();
    upsertBlackboardFact({
      id: "fact-lifecycle",
      taskId: "task-agent-runs",
      key: "risk",
      content: "initial",
      sourceMessageId: message.id,
      confidence: "medium",
    });
    upsertBlackboardFact({
      taskId: "task-agent-runs",
      key: "risk",
      content: "rejected after evaluation",
      sourceMessageId: message.id,
      confidence: "high",
      status: "rejected",
    });
    expect(listActiveFacts("task-agent-runs")).toEqual([]);
  });
});
