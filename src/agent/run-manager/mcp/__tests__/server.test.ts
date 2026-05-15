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
import { createAgentBusToolHandlers } from "../server.js";

let db: Database.Database;
let tmp: string;

beforeEach(() => {
  db = new Database(":memory:");
  ensureBaseSchema(db);
  runMigrations(db);
  setDb(db);
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-agent-bus-mcp-"));
  createTask({
    id: "task-mcp",
    discord_thread_id: "thread-mcp",
    discord_user_id: "user-1",
    prompt: "mcp task",
    cwd: tmp,
  });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("Agent Bus MCP tool handlers", () => {
  it("posts messages, writes artifacts, and updates blackboard through the shared bus", () => {
    const root = createRun({
      id: "run-root",
      taskId: "task-mcp",
      role: "supervisor",
      runtime: "fake",
      controlScope: "root",
      cwd: tmp,
      toolPolicyId: "supervisor",
      canSendKinds: ["question"],
      canReceiveKinds: ["finding", "artifact"],
    });
    const child = createRun({
      id: "run-child",
      taskId: "task-mcp",
      parentRunId: root.id,
      role: "researcher",
      runtime: "fake",
      controlScope: "child",
      cwd: tmp,
      toolPolicyId: "read-only",
      canSendKinds: ["finding", "artifact"],
      canReceiveKinds: ["question"],
    });
    const handlers = createAgentBusToolHandlers({
      taskId: "task-mcp",
      runId: child.id,
      cwd: tmp,
      bus: new AgentBus(),
    });

    const artifactResult = handlers.write_artifact({
      kind: "markdown",
      title: "Finding",
      content: "# Finding\n",
    });
    const artifactId = artifactResult.structuredContent?.artifact_id as string;
    const messageResult = handlers.post_message({
      to_run_id: root.id,
      kind: "finding",
      content_text: "MCP finding",
      artifact_ids: [artifactId],
    });
    const messageId = messageResult.structuredContent?.message_id as string;
    handlers.upsert_blackboard_fact({
      key: "mcp_finding",
      content: "available",
      confidence: "high",
      source_message_id: messageId,
    });

    const rootMailbox = new AgentBus().readMailbox({ runId: root.id });
    expect(rootMailbox).toEqual([expect.objectContaining({ id: messageId, kind: "finding" })]);
    expect(handlers.read_artifact({ artifact_id: artifactId }).content[0]?.text).toContain("Finding");
    expect(handlers.list_blackboard().content[0]?.text).toContain("mcp_finding");
  });
});
