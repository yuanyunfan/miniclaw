import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDb } from "../../../store/connection.js";
import { ensureBaseSchema, runMigrations } from "../../../store/schema.js";
import { createTask } from "../../../store/repositories/tasks.js";
import {
  appendMessage,
  createRun,
  updateRunStatus,
  upsertBlackboardFact,
  writeArtifact,
} from "../../../store/agent-run-manager.js";
import { buildFinalSynthesis } from "../final-synthesizer.js";

let db: Database.Database;
let tmp: string;

beforeEach(() => {
  db = new Database(":memory:");
  ensureBaseSchema(db);
  runMigrations(db);
  setDb(db);
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-final-synthesizer-"));
  createTask({
    id: "task-final-synthesis",
    discord_thread_id: "thread-final-synthesis",
    discord_user_id: "user-1",
    prompt: "final synthesis task",
    cwd: tmp,
  });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function seedManagedRun() {
  const root = createRun({
    id: "run-root",
    taskId: "task-final-synthesis",
    role: "supervisor",
    runtime: "fake",
    controlScope: "root",
    cwd: tmp,
    toolPolicyId: "supervisor",
    canSpawn: true,
    canSendKinds: ["*"],
    canReceiveKinds: ["*"],
  });
  const generator = createRun({
    id: "run-generator",
    taskId: "task-final-synthesis",
    parentRunId: root.id,
    requesterRunId: root.id,
    controllerRunId: root.id,
    role: "generator",
    runtime: "fake",
    controlScope: "child",
    cwd: tmp,
    toolPolicyId: "workspace-write",
    canSendKinds: ["artifact", "finding"],
    canReceiveKinds: ["handoff"],
    spawnDepth: 1,
  });
  const evaluator = createRun({
    id: "run-evaluator",
    taskId: "task-final-synthesis",
    parentRunId: root.id,
    requesterRunId: root.id,
    controllerRunId: root.id,
    role: "evaluator",
    runtime: "fake",
    controlScope: "child",
    cwd: tmp,
    toolPolicyId: "read-only",
    canSendKinds: ["verdict", "challenge"],
    canReceiveKinds: ["artifact"],
    spawnDepth: 1,
  });
  updateRunStatus(generator.id, "completed", { providerSessionId: "fake:generator" });
  updateRunStatus(evaluator.id, "completed", { providerSessionId: "fake:evaluator" });
  updateRunStatus(root.id, "completed");
  return { root, generator, evaluator };
}

describe("buildFinalSynthesis", () => {
  it("renders Chinese evidence, verification, risk, and follow-up sections without artifact bodies", () => {
    const { root, generator, evaluator } = seedManagedRun();
    const artifact = writeArtifact({
      taskId: "task-final-synthesis",
      runId: generator.id,
      kind: "markdown",
      cwd: tmp,
      title: "Implementation notes",
      summary: "pnpm exec vitest run passed for targeted tests",
      content: "# private artifact body should stay referenced\n",
    });
    const message = appendMessage({
      taskId: "task-final-synthesis",
      fromRunId: evaluator.id,
      toRunId: root.id,
      kind: "verdict",
      contentText: "PASS after verification",
      payload: { verdict: "PASS", raw: "not rendered" },
      artifactIds: [artifact.id],
    });
    upsertBlackboardFact({
      taskId: "task-final-synthesis",
      key: "verification",
      content: "targeted tests passed",
      sourceMessageId: message.id,
      confidence: "high",
    });

    const text = buildFinalSynthesis({
      taskId: "task-final-synthesis",
      verdict: "PASS",
      summary: "accepted implementation",
    });

    expect(text).toContain("MiniClaw Agent Run Manager 最终汇总");
    expect(text).toContain("Verdict: PASS");
    expect(text).toContain("## 完成内容");
    expect(text).toContain("## 关键证据");
    expect(text).toContain("## 验证结果");
    expect(text).toContain("## 剩余风险");
    expect(text).toContain("## 后续建议");
    expect(text).toContain("targeted tests passed");
    expect(text).toContain(artifact.id.slice(0, 8));
    expect(text).not.toContain("private artifact body");
  });

  it("calls out missing verification evidence and evaluator fixes on FAIL", () => {
    seedManagedRun();

    const text = buildFinalSynthesis({
      taskId: "task-final-synthesis",
      verdict: "FAIL",
      summary: "still failing",
      fixList: ["add real build evidence"],
    });

    expect(text).toContain("Verdict: FAIL");
    expect(text).toContain("未找到验证证据");
    expect(text).toContain("fix_list: add real build evidence");
  });
});
