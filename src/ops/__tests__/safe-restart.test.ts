import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
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

describe("safe-restart args", () => {
  it("parses force/json/app/db flags", () => {
    expect(parseSafeRestartArgs(["--force", "--json", "--app", "bot", "--db", "~/x.db"])).toMatchObject({
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
      { app: "miniclaw", force: false, json: false, dbPath },
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
      { app: "miniclaw", force: false, json: false, dbPath },
      { restart, stdout: (line) => stdout.push(line), stderr: () => undefined }
    );

    expect(result).toMatchObject({ ok: true, exitCode: 0 });
    expect(result.runningTasks).toHaveLength(0);
    expect(restart).toHaveBeenCalledWith("miniclaw", { json: false });
    expect(stdout.join("\n")).toContain("no running MiniClaw tasks found");
  });

  it("force mode restarts and reports running tasks", async () => {
    const dbPath = createTaskDb([{ id: "running-b", status: "running" }]);
    const restart = vi.fn(async () => 0);
    const stderr: string[] = [];

    const result = await runSafeRestart(
      { app: "miniclaw", force: true, json: false, dbPath },
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
      { app: "miniclaw", force: false, json: true, dbPath },
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
