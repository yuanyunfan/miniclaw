import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDb } from "../../../../store/connection.js";
import { ensureBaseSchema, runMigrations } from "../../../../store/schema.js";
import { createTask } from "../../../../store/repositories/tasks.js";
import { appendTaskEvent } from "../../../../store/task-events.js";
import { createRun } from "../../../../store/agent-run-manager.js";
import { AgentBus } from "../../bus.js";
import {
  DEFAULT_AGENT_RUN_MANAGER_ACP_CONFIG,
  startAgentRunAcpLifecycle,
  type AgentRunAcpLifecycleConfig,
  type AgentRunAcpLifecycleHandle,
} from "../lifecycle.js";

let db: Database.Database;
let tmp: string;

beforeEach(() => {
  db = new Database(":memory:");
  ensureBaseSchema(db);
  runMigrations(db);
  setDb(db);
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-acp-server-"));
  createTask({
    id: "task-acp-server",
    discord_thread_id: "thread-acp-server",
    discord_user_id: "user-1",
    prompt: "acp server task",
    cwd: tmp,
  });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function config(input: Partial<AgentRunAcpLifecycleConfig> = {}): AgentRunAcpLifecycleConfig {
  return {
    ...DEFAULT_AGENT_RUN_MANAGER_ACP_CONFIG,
    enabled: true,
    token: "local-token",
    ...input,
  };
}

async function request(
  handle: AgentRunAcpLifecycleHandle,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${handle.token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${handle.url}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as Record<string, unknown> : {},
    text,
  };
}

describe("Agent Run ACP HTTP server lifecycle and hardening", () => {
  it("does not start when disabled", async () => {
    await expect(startAgentRunAcpLifecycle({
      config: { ...config(), enabled: false },
      taskId: "task-acp-server",
      cwd: tmp,
      bus: new AgentBus(),
    })).resolves.toBeUndefined();
  });

  it("starts a task-scoped localhost server with bearer auth", async () => {
    const handle = await startAgentRunAcpLifecycle({
      config: config(),
      taskId: "task-acp-server",
      cwd: tmp,
      bus: new AgentBus(),
    });
    expect(handle).toBeDefined();
    try {
      const denied = await fetch(`${handle?.url}/manifest`);
      expect(denied.status).toBe(400);

      const manifest = await request(handle as AgentRunAcpLifecycleHandle, "/manifest");
      expect(manifest.status).toBe(200);
      expect(manifest.body).toMatchObject({
        name: "miniclaw-agent-run-manager",
        auth: "bearer",
      });
    } finally {
      await handle?.stop();
    }
  });

  it("enforces payload size and rate limits before invoking the adapter", async () => {
    const payloadLimited = await startAgentRunAcpLifecycle({
      config: config({ maxPayloadBytes: 20 }),
      taskId: "task-acp-server",
      cwd: tmp,
      bus: new AgentBus(),
    });
    try {
      const response = await request(payloadLimited as AgentRunAcpLifecycleHandle, "/runs", {
        method: "POST",
        body: JSON.stringify({ role: "external-agent-with-a-long-role-name" }),
      });
      expect(response.status).toBe(413);
      expect(response.body.error).toContain("max_payload_bytes=20");
    } finally {
      await payloadLimited?.stop();
    }

    const rateLimited = await startAgentRunAcpLifecycle({
      config: config({ rateLimitMaxRequests: 1, rateLimitWindowMs: 60_000 }),
      taskId: "task-acp-server",
      cwd: tmp,
      bus: new AgentBus(),
    });
    try {
      expect((await request(rateLimited as AgentRunAcpLifecycleHandle, "/manifest")).status).toBe(200);
      const second = await request(rateLimited as AgentRunAcpLifecycleHandle, "/manifest");
      expect(second.status).toBe(429);
      expect(second.body.error).toContain("rate limit");
    } finally {
      await rateLimited?.stop();
    }
  });

  it("exports redacted task traces when trace export is enabled", async () => {
    appendTaskEvent({
      taskId: "task-acp-server",
      eventType: "task_started",
      message: "token=fixture-token-value-that-must-be-redacted prompt=this should not be exported",
      payload: { session_id: "codex:secret-session", prompt: "raw prompt" },
    });
    createRun({
      id: "run-root",
      taskId: "task-acp-server",
      role: "supervisor",
      runtime: "fake",
      controlScope: "root",
      cwd: tmp,
      toolPolicyId: "supervisor",
      canSendKinds: ["question"],
      canReceiveKinds: ["finding"],
    });
    const handle = await startAgentRunAcpLifecycle({
      config: config({ traceExportEnabled: true }),
      taskId: "task-acp-server",
      cwd: tmp,
      bus: new AgentBus(),
    });
    try {
      const trace = await request(handle as AgentRunAcpLifecycleHandle, "/trace");
      expect(trace.status).toBe(200);
      expect(trace.body.summary).toContain("Task trace task-acp");
      expect(trace.body.redaction_policy).toContain("shared diagnostic redaction");
      expect(trace.body.markdown).not.toContain("fixture-token-value-that-must-be-redacted");
      expect(trace.body.markdown).not.toContain("this should not be exported");
      expect(trace.body.markdown).not.toContain("- prompt: raw prompt");
      expect(trace.body.markdown).toContain("[REDACTED]");
    } finally {
      await handle?.stop();
    }
  });
});
