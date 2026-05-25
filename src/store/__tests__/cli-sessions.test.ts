import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureBaseSchema, runMigrations } from "../schema.js";
import { setDb } from "../connection.js";
import {
  createCliSessionApproval,
  getCliSessionApproval,
  getCliSessionByProviderSession,
  hideCliSession,
  listCliSessionEvents,
  listPendingCliSessionApprovals,
  listCliSessions,
  markDeadCliSessions,
  recordCliSessionHookEvent,
  resolveCliSessionApproval,
} from "../db.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  setDb(db);
  ensureBaseSchema(db);
  runMigrations(db);
});

afterEach(() => {
  db.close();
});

describe("cli session repository", () => {
  it("upserts hook events and appends redacted event payloads", () => {
    const session = recordCliSessionHookEvent({
      provider: "claude",
      providerSessionId: "claude-session-1",
      eventName: "UserPromptSubmit",
      cwd: "/repo",
      pid: 123,
      tty: "ttys001",
      terminalApp: "iTerm.app",
      prompt: "implement feature",
      payload: {
        prompt: "implement feature",
        api_key: "secret",
      },
      receivedAt: new Date("2026-05-25T00:00:00.000Z"),
    });

    expect(session.provider).toBe("claude");
    expect(session.phase).toBe("processing");
    expect(session.observed_prompt_count).toBe(1);

    const updated = recordCliSessionHookEvent({
      provider: "claude",
      providerSessionId: "claude-session-1",
      eventName: "Stop",
      cwd: "/repo",
      payload: { status: "done" },
      receivedAt: new Date("2026-05-25T00:01:00.000Z"),
    });

    expect(updated.id).toBe(session.id);
    expect(updated.phase).toBe("waiting_for_input");
    expect(listCliSessions({ status: "idle" }).map((row) => row.id)).toEqual([session.id]);

    const events = listCliSessionEvents(session.id);
    expect(events).toHaveLength(2);
    expect(events[1]?.payload_json).toContain("[redacted]");
    expect(events[1]?.payload_json).not.toContain("secret");
  });

  it("marks dead pid-backed sessions ended", () => {
    const session = recordCliSessionHookEvent({
      provider: "codex",
      providerSessionId: "codex-session-1",
      eventName: "UserPromptSubmit",
      cwd: "/repo",
      pid: 4242,
      receivedAt: new Date("2026-05-25T00:00:00.000Z"),
    });

    const count = markDeadCliSessions({
      isPidAlive: (pid) => pid !== 4242,
      now: new Date("2026-05-25T00:02:00.000Z"),
    });

    expect(count).toBe(1);
    expect(getCliSessionByProviderSession("codex", "codex-session-1")?.phase).toBe("ended");
    expect(listCliSessions({ status: "closed" }).map((row) => row.id)).toEqual([session.id]);
  });

  it("hides sessions from the default list without deleting history", () => {
    const session = recordCliSessionHookEvent({
      provider: "claude",
      providerSessionId: "claude-session-hide",
      eventName: "Stop",
      cwd: "/repo",
    });

    expect(hideCliSession(session.id)).toBe(true);
    expect(listCliSessions()).toEqual([]);
    expect(listCliSessions({ status: "hidden", includeHidden: true })).toHaveLength(1);
  });

  it("records and resolves pending CLI session approval requests", () => {
    const event = {
      provider: "claude" as const,
      providerSessionId: "claude-approval-1",
      eventName: "PermissionRequest",
      cwd: "/repo",
      toolName: "Bash",
      toolInput: { command: "git status", token: "secret" },
      toolUseId: "toolu-1",
      receivedAt: new Date("2026-05-25T00:00:00.000Z"),
    };
    const session = recordCliSessionHookEvent(event);
    const approval = createCliSessionApproval({
      session,
      event,
      timeoutMs: 60_000,
    });

    expect(approval).toMatchObject({
      cli_session_id: session.id,
      provider: "claude",
      status: "pending",
      tool_name: "Bash",
      tool_use_id: "toolu-1",
    });
    expect(approval.request_json).not.toContain("secret");
    expect(listPendingCliSessionApprovals()).toHaveLength(1);

    const resolved = resolveCliSessionApproval({
      id: approval.id,
      decision: "allow",
      actorId: "discord-user",
    });

    expect(resolved?.status).toBe("approved");
    expect(getCliSessionApproval(approval.id)?.actor_id).toBe("discord-user");
    expect(listPendingCliSessionApprovals()).toEqual([]);
  });
});
