import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDb } from "../../../../store/connection.js";
import { ensureBaseSchema, runMigrations } from "../../../../store/schema.js";
import { createTask } from "../../../../store/repositories/tasks.js";
import { createRun } from "../../../../store/agent-run-manager.js";
import { AgentBus } from "../../bus.js";
import { AgentRunAcpAdapter } from "../adapter.js";

let db: Database.Database;
let tmp: string;

beforeEach(() => {
  db = new Database(":memory:");
  ensureBaseSchema(db);
  runMigrations(db);
  setDb(db);
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-acp-adapter-"));
  createTask({
    id: "task-acp",
    discord_thread_id: "thread-acp",
    discord_user_id: "user-1",
    prompt: "acp task",
    cwd: tmp,
  });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("AgentRunAcpAdapter", () => {
  it("round-trips manifest, external run, messages, artifacts, and blackboard facts", () => {
    const root = createRun({
      id: "run-root",
      taskId: "task-acp",
      role: "supervisor",
      runtime: "fake",
      controlScope: "root",
      cwd: tmp,
      toolPolicyId: "supervisor",
      canSendKinds: ["question"],
      canReceiveKinds: ["finding", "artifact", "verdict"],
    });
    const adapter = new AgentRunAcpAdapter({
      taskId: "task-acp",
      cwd: tmp,
      bus: new AgentBus(),
      token: "local-token",
    });

    expect(adapter.manifest("local-token")).toMatchObject({
      name: "miniclaw-agent-run-manager",
      auth: "bearer",
    });
    expect(() => adapter.manifest("wrong-token")).toThrow(/token rejected/);

    const external = adapter.createExternalRun({
      role: "external-evaluator",
      parentRunId: root.id,
      token: "local-token",
    });
    const artifact = adapter.publishArtifact({
      runId: external.id,
      kind: "markdown",
      title: "External verdict",
      content: "# Verdict\nPASS\n",
      token: "local-token",
    });
    const message = adapter.postMessage({
      fromRunId: external.id,
      toRunId: root.id,
      kind: "finding",
      contentText: "external finding",
      artifactIds: [artifact.id],
      token: "local-token",
    });
    const fact = adapter.upsertBlackboardFact({
      key: "external_verdict",
      content: "PASS",
      confidence: "high",
      sourceMessageId: message.id,
      token: "local-token",
    });

    expect(adapter.readMailbox({ runId: root.id, token: "local-token" }).map((row) => row.id)).toEqual([message.id]);
    expect(adapter.readArtifact({ artifactId: artifact.id, token: "local-token" })?.content).toContain("PASS");
    expect(adapter.listBlackboard("local-token")).toEqual([expect.objectContaining({ id: fact.id, key: "external_verdict" })]);
  });
});
