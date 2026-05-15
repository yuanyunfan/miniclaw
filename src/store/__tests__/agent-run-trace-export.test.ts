import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDb } from "../connection.js";
import { ensureBaseSchema, runMigrations } from "../schema.js";
import { createTask } from "../repositories/tasks.js";
import { appendTaskEvent } from "../task-events.js";
import {
  appendMessage,
  createRun,
  upsertAgentSchedulerState,
  upsertBlackboardFact,
  writeArtifact,
} from "../agent-run-manager.js";
import {
  buildAgentRunTraceModel,
  renderAgentRunTraceMarkdown,
} from "../agent-run-trace-export.js";
import { buildTaskTraceModel, renderTaskTraceMarkdown } from "../task-trace-export.js";

let db: Database.Database;
let tmp: string;

beforeEach(() => {
  db = new Database(":memory:");
  ensureBaseSchema(db);
  runMigrations(db);
  setDb(db);
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-agent-run-trace-"));
  createTask({
    id: "task-agent-run-trace",
    discord_thread_id: "thread-agent-run-trace",
    discord_user_id: "user-1",
    prompt: "prompt must stay out of agent run trace",
    cwd: tmp,
  });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function seedTrace() {
  const root = createRun({
    id: "run-root",
    taskId: "task-agent-run-trace",
    role: "supervisor",
    runtime: "fake",
    providerSessionId: "codex:private-session-id",
    controlScope: "root",
    cwd: tmp,
    toolPolicyId: "supervisor",
    canSpawn: true,
    canSendKinds: ["*"],
    canReceiveKinds: ["*"],
  });
  const generator = createRun({
    id: "run-generator",
    taskId: "task-agent-run-trace",
    parentRunId: root.id,
    requesterRunId: root.id,
    controllerRunId: root.id,
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
  const artifact = writeArtifact({
    taskId: "task-agent-run-trace",
    runId: generator.id,
    kind: "markdown",
    cwd: tmp,
    title: "Implementation summary",
    summary: "validated with pnpm exec vitest run",
    content: "# raw artifact body must not be exported\n",
  });
  const message = appendMessage({
    taskId: "task-agent-run-trace",
    fromRunId: generator.id,
    toRunId: root.id,
    kind: "artifact",
    contentText: "artifact ready, token=secret-token-123456",
    payload: { verdict: "PASS", prompt: "raw prompt must not render" },
    artifactIds: [artifact.id],
  });
  upsertBlackboardFact({
    taskId: "task-agent-run-trace",
    key: "verification",
    content: "vitest passed",
    sourceMessageId: message.id,
    confidence: "high",
  });
  upsertAgentSchedulerState({
    taskId: "task-agent-run-trace",
    rootRunId: root.id,
    schedulerVersion: "managed-runtime-dag-v1",
    status: "completed",
    currentStep: "dag:completed",
    lastMessageId: message.id,
    plan: {
      version: "managed-runtime-dag-v1",
      max_parallel: 2,
      nodes: [
        { id: "generator", role: "generator" },
      ],
    },
  });
  return { root, generator, artifact, message };
}

describe("agent run trace export", () => {
  it("exports managed run tree, scheduler, messages, artifacts, and blackboard without raw bodies", () => {
    const seeded = seedTrace();

    const model = buildAgentRunTraceModel("task-agent-run-trace");
    expect(model).toBeDefined();
    if (!model) throw new Error("missing trace model");

    expect(model.runs).toHaveLength(2);
    expect(model.scheduler).toMatchObject({
      status: "completed",
      currentStep: "dag:completed",
      planVersion: "managed-runtime-dag-v1",
      planNodeCount: 1,
      planMaxParallel: 2,
    });
    expect(model.messages[0]).toMatchObject({
      fromRole: "generator",
      toRole: "supervisor",
      payloadKeys: ["prompt", "verdict"],
    });

    const markdown = renderAgentRunTraceMarkdown(model);
    expect(markdown).toContain("## Agent Run Manager");
    expect(markdown).toContain("### Scheduler");
    expect(markdown).toContain("generator");
    expect(markdown).toContain(seeded.artifact.id.slice(0, 8));
    expect(markdown).toContain("token=[REDACTED]");
    expect(markdown).not.toContain("raw artifact body");
    expect(markdown).not.toContain("raw prompt must not render");
    expect(markdown).not.toContain("codex:private-session-id");
  });

  it("is embedded in task trace markdown when a task has managed agent state", () => {
    seedTrace();
    appendTaskEvent({
      taskId: "task-agent-run-trace",
      eventType: "task_started",
      payload: { provider: "codex" },
    });

    const result = buildTaskTraceModel("task-agent-run-trace");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.agentRunTrace).toBeDefined();
    const markdown = renderTaskTraceMarkdown(result.value);
    expect(markdown).toContain("## Agent Run Manager");
    expect(markdown).toContain("## Timeline");
  });
});
