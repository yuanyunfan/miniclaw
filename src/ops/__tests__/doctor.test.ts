import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatDoctorReport,
  parseDoctorArgs,
  redactSensitive,
  runDoctor,
  type CommandRunner,
} from "../doctor.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-doctor-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function createTaskDb(rows: Array<{
  id: string;
  status: string;
  prompt?: string;
  result_summary?: string | null;
  created_at?: string;
  events?: Array<{
    event_type: string;
    severity?: string;
    message?: string;
    payload_json?: string;
    created_at?: string;
  }>;
}>): string {
  const dbPath = join(tmp, "data.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      discord_thread_id TEXT,
      discord_user_id TEXT,
      prompt TEXT NOT NULL,
      cwd TEXT,
      session_id TEXT,
      status TEXT NOT NULL,
      result_summary TEXT,
      cost_usd REAL,
      duration_ms INTEGER,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      progress_message_id TEXT,
      source_route_type TEXT,
      source_channel_id TEXT,
      source_message_id TEXT,
      source_message_url TEXT,
      source_metadata_json TEXT,
      parent_context_json TEXT
    );
    CREATE TABLE task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      message TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const insert = db.prepare(
    `INSERT INTO tasks (
       id, discord_thread_id, discord_user_id, prompt, cwd, session_id, status,
       result_summary, duration_ms, created_at, completed_at, source_route_type, source_channel_id
     )
     VALUES (
       @id, @discord_thread_id, @discord_user_id, @prompt, @cwd, @session_id, @status,
       @result_summary, @duration_ms, @created_at, @completed_at, @source_route_type, @source_channel_id
     )`
  );
  const insertEvent = db.prepare(
    `INSERT INTO task_events (task_id, event_type, severity, message, payload_json, created_at)
     VALUES (@task_id, @event_type, @severity, @message, @payload_json, @created_at)`
  );
  for (const row of rows) {
    insert.run({
      id: row.id,
      discord_thread_id: "thread-1",
      discord_user_id: "user-1",
      prompt: row.prompt ?? "diagnose failed task",
      cwd: tmp,
      session_id: "sess-1",
      status: row.status,
      result_summary: row.result_summary ?? null,
      duration_ms: 12_000,
      created_at: row.created_at ?? "2026-05-10T03:00:00.000Z",
      completed_at: row.status === "running" ? null : "2026-05-10T03:10:00.000Z",
      source_route_type: "task_channel",
      source_channel_id: "channel-1",
    });
    for (const event of row.events ?? []) {
      insertEvent.run({
        task_id: row.id,
        event_type: event.event_type,
        severity: event.severity ?? "info",
        message: event.message ?? null,
        payload_json: event.payload_json ?? null,
        created_at: event.created_at ?? "2026-05-10T03:11:00.000Z",
      });
    }
  }
  db.close();
  return dbPath;
}

function writeJson(path: string, value: unknown): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
  return path;
}

function writeLogDir(lines: string[]): string {
  const dir = join(tmp, "logs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "miniclaw-error.log"), lines.join("\n"), "utf8");
  writeFileSync(join(dir, "miniclaw-out.log"), "", "utf8");
  return dir;
}

function fakeRunner(status = ""): CommandRunner {
  return (cmd, args) => {
    if (cmd === "pm2") {
      return JSON.stringify([
        { pid: 123, pm2_env: { name: "miniclaw", status: "online", restart_time: 2, unstable_restarts: 0, pm_uptime: 1_776_000_000_000 } },
      ]);
    }
    if (cmd === "git" && args.join(" ") === "rev-parse --abbrev-ref HEAD") return "main\n";
    if (cmd === "git" && args.join(" ") === "rev-parse --short HEAD") return "abc1234\n";
    if (cmd === "git" && args.join(" ") === "remote get-url origin") return "git@github-personal:yuanyunfan/miniclaw.git\n";
    if (cmd === "git" && args.join(" ") === "status --short") return status;
    throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
  };
}

describe("parseDoctorArgs", () => {
  it("parses task mode and paths", () => {
    expect(parseDoctorArgs(["--task", "abc", "--json", "--db", "~/data.db"])).toMatchObject({
      mode: "task",
      taskIdPrefix: "abc",
      json: true,
    });
  });
});

describe("redactSensitive", () => {
  it("redacts common secret shapes", () => {
    expect(redactSensitive("token=sk-abcdefghijklmnopqrstuvwxyz1234567890")).toContain("token=[redacted]");
    expect(redactSensitive("cookie: abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz")).toContain("cookie=[redacted]");
  });
});

describe("runDoctor", () => {
  it("diagnoses failed task with code-error signals as repairable when git is clean", async () => {
    const dbPath = createTaskDb([{
      id: "task-failed-1",
      status: "failed",
      result_summary: "TypeError: Cannot read properties of undefined",
    }]);
    const cronStatePath = writeJson(join(tmp, "cron-state.json"), { jobs: {} });
    const connectivityStatePath = writeJson(join(tmp, "connectivity.json"), {
      updated_at: "2026-05-10T03:11:00.000Z",
      status: "discord_ok",
      consecutive_failures: 0,
      checks: {},
    });
    const logDir = writeLogDir(["2026 error TypeError: Cannot read properties of undefined"]);

    const report = await runDoctor(
      {
        mode: "task",
        taskIdPrefix: "task-failed",
        json: false,
        dbPath,
        cronStatePath,
        connectivityStatePath,
        logDir,
        cwd: tmp,
      },
      { now: () => new Date("2026-05-10T03:20:00.000Z"), commandRunner: fakeRunner() }
    );

    expect(report.diagnosis).toMatchObject({
      incidentType: "task_failed",
      category: "miniclaw_bug",
      repairAllowed: true,
    });
    expect(formatDoctorReport(report)).toContain("Task failed");
  });

  it("diagnoses cron auth failures as not auto-repairable", async () => {
    const dbPath = createTaskDb([]);
    const cronStatePath = writeJson(join(tmp, "cron-state.json"), {
      jobs: {
        "daily-news": {
          last_run_at: "2026-05-10T02:00:00.000Z",
          last_status: "error",
          last_error: "cookie expired token=abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz",
          last_duration_ms: 1200,
          completed: 3,
        },
      },
    });
    const connectivityStatePath = writeJson(join(tmp, "connectivity.json"), {
      status: "discord_ok",
      consecutive_failures: 0,
      checks: {},
    });

    const report = await runDoctor(
      {
        mode: "cron",
        cronJobName: "daily-news",
        json: false,
        dbPath,
        cronStatePath,
        connectivityStatePath,
        logDir: writeLogDir([]),
        cwd: tmp,
      },
      { commandRunner: fakeRunner() }
    );

    expect(report.diagnosis).toMatchObject({
      incidentType: "cron_failed",
      category: "provider_auth",
      repairAllowed: false,
    });
    expect(formatDoctorReport(report)).toContain("cookie expired token=[redacted]");
  });

  it("blocks repair when git has dirty files", async () => {
    const dbPath = createTaskDb([{ id: "task-failed-2", status: "failed", result_summary: "TypeError: boom" }]);
    const cronStatePath = writeJson(join(tmp, "cron-state.json"), { jobs: {} });
    const connectivityStatePath = writeJson(join(tmp, "connectivity.json"), { status: "discord_ok", checks: {} });

    const report = await runDoctor(
      {
        mode: "task",
        taskIdPrefix: "task-failed-2",
        json: false,
        dbPath,
        cronStatePath,
        connectivityStatePath,
        logDir: writeLogDir([]),
        cwd: tmp,
      },
      { commandRunner: fakeRunner(" M src/file.ts\n") }
    );

    expect(report.diagnosis.repairAllowed).toBe(false);
    expect(report.diagnosis.recommendedAction).toContain("dirty files");
  });

  it("uses normalized task trace events before falling back to raw logs", async () => {
    const dbPath = createTaskDb([{
      id: "task-discord-trace",
      status: "failed",
      result_summary: "final message delivery failed",
      events: [{
        event_type: "discord_delivery_failed",
        severity: "warning",
        message: "Missing Access while editing final status",
        payload_json: JSON.stringify({ operation: "final_markdown_send" }),
      }],
    }]);
    const cronStatePath = writeJson(join(tmp, "cron-state.json"), { jobs: {} });
    const connectivityStatePath = writeJson(join(tmp, "connectivity.json"), { status: "discord_ok", checks: {} });

    const report = await runDoctor(
      {
        mode: "task",
        taskIdPrefix: "task-discord",
        json: false,
        dbPath,
        cronStatePath,
        connectivityStatePath,
        logDir: writeLogDir([]),
        cwd: tmp,
      },
      { commandRunner: fakeRunner() }
    );

    expect(report.evidence.taskEvents).toHaveLength(1);
    expect(report.diagnosis.category).toBe("discord");
    expect(report.diagnosis.evidenceSummary.some((line) => line.includes("trace_errors="))).toBe(true);
    expect(formatDoctorReport(report)).toContain("Recent task trace events");
  });
});
