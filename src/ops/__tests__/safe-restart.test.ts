import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseSafeRestartArgs,
  resolveSafeRestartDbPath,
  runSafeRestart,
  type RunningTaskSummary,
} from "../safe-restart.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-safe-restart-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function createTaskDb(rows: Array<Partial<RunningTaskSummary> & { status: string }>): string {
  const dbPath = join(tmp, "data.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      cwd TEXT,
      session_id TEXT,
      discord_thread_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const insert = db.prepare(
    `INSERT INTO tasks (id, prompt, cwd, session_id, discord_thread_id, status, created_at)
     VALUES (@id, @prompt, @cwd, @session_id, @discord_thread_id, @status, @created_at)`
  );
  rows.forEach((row, idx) => {
    insert.run({
      id: row.id ?? `task-${idx}`,
      prompt: row.prompt ?? `prompt ${idx}`,
      cwd: row.cwd ?? tmp,
      session_id: row.session_id ?? null,
      discord_thread_id: row.discord_thread_id ?? null,
      status: row.status,
      created_at: row.created_at ?? `2026-05-09T00:00:0${idx}Z`,
    });
  });
  db.close();
  return dbPath;
}

function createActiveChatState(rows: Array<{
  id: string;
  prompt?: string;
  pid?: number;
}>): string {
  const path = join(tmp, "active-chats.json");
  writeFileSync(path, JSON.stringify({
    version: 1,
    updated_at: "2026-05-10T01:00:00.000Z",
    chats: rows.map((row, idx) => ({
      id: row.id,
      channel_id: `channel-${idx}`,
      user_id: `user-${idx}`,
      prompt: row.prompt ?? `chat prompt ${idx}`,
      started_at: `2026-05-10T01:00:0${idx}.000Z`,
      pid: row.pid ?? process.pid,
    })),
  }), "utf8");
  return path;
}

function emptyActiveChatStatePath(): string {
  return join(tmp, "missing-active-chats.json");
}

describe("safe-restart args", () => {
  it("parses force/json/app/db flags", () => {
    expect(parseSafeRestartArgs([
      "--force",
      "--json",
      "--app",
      "bot",
      "--db",
      "~/x.db",
      "--active-chat-state",
      "~/active-chats.json",
    ])).toMatchObject({
      force: true,
      json: true,
      app: "bot",
    });
  });
});

describe("resolveSafeRestartDbPath", () => {
  it("prefers MINICLAW_DB_PATH", () => {
    expect(resolveSafeRestartDbPath({ MINICLAW_DB_PATH: join(tmp, "override.db") })).toBe(join(tmp, "override.db"));
  });
});

describe("runSafeRestart", () => {
  it("refuses to restart when running tasks exist", async () => {
    const dbPath = createTaskDb([{ id: "running-a", status: "running", prompt: "do work" }]);
    const restart = vi.fn(async () => 0);
    const stderr: string[] = [];

    const result = await runSafeRestart(
      { app: "miniclaw", force: false, json: false, dbPath, activeChatStatePath: emptyActiveChatStatePath() },
      { restart, stderr: (line) => stderr.push(line), stdout: () => undefined }
    );

    expect(result).toMatchObject({ ok: false, exitCode: 1, reason: "running_tasks" });
    expect(result.runningTasks.map((t) => t.id)).toEqual(["running-a"]);
    expect(restart).not.toHaveBeenCalled();
    expect(stderr.join("\n")).toContain("Refusing to restart PM2 app");
  });

  it("restarts when no running tasks exist", async () => {
    const dbPath = createTaskDb([{ id: "done-a", status: "completed" }]);
    const restart = vi.fn(async () => 0);
    const stdout: string[] = [];

    const result = await runSafeRestart(
      { app: "miniclaw", force: false, json: false, dbPath, activeChatStatePath: emptyActiveChatStatePath() },
      { restart, stdout: (line) => stdout.push(line), stderr: () => undefined }
    );

    expect(result).toMatchObject({ ok: true, exitCode: 0 });
    expect(result.runningTasks).toHaveLength(0);
    expect(result.runningChats).toHaveLength(0);
    expect(restart).toHaveBeenCalledWith("miniclaw", { json: false });
    expect(stdout.join("\n")).toContain("no running MiniClaw tasks or active chats found");
  });

  it("refuses to restart when active chats exist", async () => {
    const dbPath = createTaskDb([{ id: "done-a", status: "completed" }]);
    const activeChatStatePath = createActiveChatState([{ id: "chat-running", prompt: "answer a long chat" }]);
    const restart = vi.fn(async () => 0);
    const stderr: string[] = [];

    const result = await runSafeRestart(
      { app: "miniclaw", force: false, json: false, dbPath, activeChatStatePath },
      { restart, stdout: () => undefined, stderr: (line) => stderr.push(line) }
    );

    expect(result).toMatchObject({ ok: false, exitCode: 1, reason: "running_chats" });
    expect(result.runningChats.map((chat) => chat.id)).toEqual(["chat-running"]);
    expect(restart).not.toHaveBeenCalled();
    expect(stderr.join("\n")).toContain("0 running task(s), 1 active chat(s)");
  });

  it("ignores stale active chat state for dead pids", async () => {
    const dbPath = createTaskDb([{ id: "done-a", status: "completed" }]);
    const activeChatStatePath = createActiveChatState([{ id: "stale-chat", pid: 999_999_999 }]);
    const restart = vi.fn(async () => 0);

    const result = await runSafeRestart(
      { app: "miniclaw", force: false, json: false, dbPath, activeChatStatePath },
      { restart, stdout: () => undefined, stderr: () => undefined }
    );

    expect(result).toMatchObject({ ok: true, exitCode: 0 });
    expect(result.runningChats).toEqual([]);
    expect(restart).toHaveBeenCalledWith("miniclaw", { json: false });
  });

  it("force mode restarts and reports running tasks", async () => {
    const dbPath = createTaskDb([{ id: "running-b", status: "running" }]);
    const restart = vi.fn(async () => 0);
    const stderr: string[] = [];

    const result = await runSafeRestart(
      { app: "miniclaw", force: true, json: false, dbPath, activeChatStatePath: emptyActiveChatStatePath() },
      { restart, stdout: () => undefined, stderr: (line) => stderr.push(line) }
    );

    expect(result).toMatchObject({ ok: true, exitCode: 0 });
    expect(result.runningTasks.map((t) => t.id)).toEqual(["running-b"]);
    expect(restart).toHaveBeenCalledWith("miniclaw", { json: false });
    expect(stderr.join("\n")).toContain("Force restarting");
  });

  it("prints a single JSON result in json refusal mode", async () => {
    const dbPath = createTaskDb([{ id: "running-json", status: "running" }]);
    const stdout: string[] = [];

    await runSafeRestart(
      { app: "miniclaw", force: false, json: true, dbPath, activeChatStatePath: emptyActiveChatStatePath() },
      { stdout: (line) => stdout.push(line), stderr: () => undefined }
    );

    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0])).toMatchObject({
      ok: false,
      reason: "running_tasks",
      runningTasks: [{ id: "running-json" }],
    });
  });
});
