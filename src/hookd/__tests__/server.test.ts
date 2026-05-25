import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __testables,
  startHookd,
  startHookdSocketServer,
  type HookdHandle,
  type HookdSocketServerHandle,
} from "../server.js";
import { sendHookdEvent } from "../transport.js";
import type { CliSessionHookEvent } from "../types.js";
import { setDb } from "../../store/connection.js";
import { recordCliSessionHookEvent } from "../../store/db.js";
import { ensureBaseSchema, runMigrations } from "../../store/schema.js";

let tmp: string;
let handle: HookdSocketServerHandle | null = null;
let runtime: HookdHandle | null = null;
let db: Database.Database | null = null;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-hookd-server-"));
});

afterEach(async () => {
  await runtime?.stop();
  runtime = null;
  await handle?.stop();
  handle = null;
  db?.close();
  db = null;
});

function waitForListening(server: HookdSocketServerHandle): Promise<void> {
  if (server.server.listening) return Promise.resolve();
  return new Promise((resolve) => server.server.once("listening", resolve));
}

async function waitForSocket(path: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (existsSync(path)) return;
    await delay(10);
  }
  throw new Error(`socket did not appear: ${path}`);
}

function setupDb(): void {
  db = new Database(":memory:");
  setDb(db);
  ensureBaseSchema(db);
  runMigrations(db);
}

describe("hookd socket server", () => {
  it("accepts newline-delimited hook events over a Unix socket", async () => {
    const events: CliSessionHookEvent[] = [];
    handle = startHookdSocketServer({
      socketPath: join(tmp, "hookd.sock"),
      onEvent: (event) => {
        events.push(event);
        return { session: event.providerSessionId };
      },
    });
    await waitForListening(handle);

    const result = await sendHookdEvent(handle.socketPath, {
      provider: "claude",
      session_id: "session-1",
      hook_event_name: "UserPromptSubmit",
      cwd: "/repo",
      parent_pid: 123,
    });

    expect(result).toEqual({ session: "session-1" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: "claude",
      providerSessionId: "session-1",
      eventName: "UserPromptSubmit",
      phase: "processing",
      pid: 123,
    });
  });

  it("accepts CodeIsland-style event/status fields and tool approval metadata", () => {
    const event = __testables.parseHookEvent({
      provider: "claude",
      session_id: "session-approval",
      event: "PermissionRequest",
      status: "waiting_for_approval",
      cwd: "/repo",
      tool: "Bash",
      tool_input: { command: "git status" },
      tool_use_id: "toolu-1",
    });

    expect(event).toMatchObject({
      provider: "claude",
      providerSessionId: "session-approval",
      eventName: "PermissionRequest",
      phase: "waiting_for_approval",
      toolName: "Bash",
      toolUseId: "toolu-1",
    });
    expect(event.toolInput).toEqual({ command: "git status" });
  });

  it("rejects unsupported provider payloads", () => {
    expect(() => __testables.parseHookEvent({
      provider: "unknown",
      session_id: "session-1",
      hook_event_name: "Stop",
      cwd: "/repo",
    })).toThrow("unsupported hook event provider");
  });
});

describe("hookd runtime session-state callbacks", () => {
  it("notifies after a hook event is recorded", async () => {
    setupDb();
    const onSessionStateChanged = vi.fn();
    runtime = startHookd({
      enabled: true,
      socketPath: join(tmp, "runtime.sock"),
      maxPayloadBytes: 256 * 1024,
      zombieScanIntervalMs: 60_000,
      approvalTimeoutMs: 60_000,
    }, { onSessionStateChanged });
    expect(runtime).not.toBeNull();
    await waitForSocket(runtime!.socketPath);

    await sendHookdEvent(runtime!.socketPath, {
      provider: "codex",
      session_id: "codex-session-1",
      hook_event_name: "UserPromptSubmit",
      cwd: "/repo",
    });
    await Promise.resolve();

    expect(onSessionStateChanged).toHaveBeenCalledOnce();
  });

  it("notifies when zombie scan marks a session ended", async () => {
    setupDb();
    const onSessionStateChanged = vi.fn();
    runtime = startHookd({
      enabled: true,
      socketPath: join(tmp, "runtime.sock"),
      maxPayloadBytes: 256 * 1024,
      zombieScanIntervalMs: 60_000,
      approvalTimeoutMs: 60_000,
    }, { onSessionStateChanged });
    expect(runtime).not.toBeNull();
    recordCliSessionHookEvent({
      provider: "codex",
      providerSessionId: "codex-session-2",
      eventName: "UserPromptSubmit",
      cwd: "/repo",
      pid: 999_999_999,
      receivedAt: new Date("2026-05-25T00:00:00.000Z"),
    });

    expect(runtime!.scanNow()).toBe(1);
    await Promise.resolve();

    expect(onSessionStateChanged).toHaveBeenCalledOnce();
  });
});
