import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDb } from "../../store/connection.js";
import { recordCliSessionHookEvent } from "../../store/db.js";
import { ensureBaseSchema, runMigrations } from "../../store/schema.js";
import { HookdApprovalRegistry } from "../approvals.js";

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

function session() {
  return recordCliSessionHookEvent({
    provider: "claude",
    providerSessionId: "claude-session-1",
    eventName: "PermissionRequest",
    cwd: "/repo",
    pid: 123,
  });
}

describe("HookdApprovalRegistry", () => {
  it("resolves a pending approval from Discord", async () => {
    const registry = new HookdApprovalRegistry();
    const wait = registry.requestApproval({
      session: session(),
      event: {
        provider: "claude",
        providerSessionId: "claude-session-1",
        eventName: "PermissionRequest",
        cwd: "/repo",
        toolName: "Bash",
      },
      timeoutMs: 1000,
    });

    const pendingId = db.prepare("SELECT id FROM cli_session_approvals WHERE status = 'pending'").get() as { id: string };
    registry.resolve(pendingId.id, "allow", "discord-user");

    await expect(wait).resolves.toMatchObject({
      approvalRequestId: pendingId.id,
      decision: "allow",
    });
  });

  it("denies immediately when the approval timeout budget is zero", async () => {
    const registry = new HookdApprovalRegistry();

    await expect(registry.requestApproval({
      session: session(),
      event: {
        provider: "claude",
        providerSessionId: "claude-session-1",
        eventName: "PermissionRequest",
        cwd: "/repo",
      },
      timeoutMs: 0,
    })).resolves.toMatchObject({
      decision: "deny",
    });
  });
});
