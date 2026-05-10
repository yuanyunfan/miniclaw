import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import type { DoctorReport } from "../doctor.js";
import type { DoctorRepairResult } from "../doctor-repair.js";
import type { IncidentRow } from "../../store/incidents.js";

const ENV_KEYS = [
  "MINICLAW_DOCTOR_ENABLED",
  "MINICLAW_DOCTOR_AUTO_DIAGNOSE_ENABLED",
  "MINICLAW_DOCTOR_AUTO_REPAIR_ENABLED",
  "MINICLAW_DOCTOR_MAX_REPAIRS_PER_DAY",
  "MINICLAW_DOCTOR_MAX_PARALLEL_REPAIRS",
  "MINICLAW_DOCTOR_SUMMARY_CHANNEL_ID",
] as const;

let previousEnv: Record<string, string | undefined>;

function reportWithFailedTask(): DoctorReport {
  return {
    evidence: {
      generatedAt: "2026-05-10T04:00:00.000Z",
      mode: "recent",
      dbPath: "/tmp/miniclaw.db",
      cronStatePath: "/tmp/cron-state.json",
      connectivityStatePath: "/tmp/connectivity.json",
      taskCandidates: [{
        id: "task-123456",
        status: "failed",
        prompt: "fix bug",
        result_summary: "TypeError: boom",
      }],
      cronErrors: [],
      pm2: { app: "miniclaw", found: true, status: "online", restartCount: 1 },
      git: { cwd: "/repo", branch: "main", sha: "abc1234", dirtyFiles: [] },
      connectivity: { status: "discord_ok", consecutive_failures: 0 },
      logs: [],
    },
    diagnosis: {
      incidentType: "task_failed",
      severity: "warning",
      category: "miniclaw_bug",
      title: "Task failed: task-123",
      summary: "The strongest signal points to a MiniClaw code/runtime bug.",
      evidenceSummary: ["task=task-123 status=failed", "git=main@abc1234 dirty=0"],
      repairAllowed: true,
      recommendedAction: "Repair later.",
    },
  };
}

function incidentRow(): IncidentRow {
  return {
    id: "incident-123456",
    dedupe_key: "task:task-123456:failed",
    type: "task_failed",
    severity: "warning",
    status: "diagnosed",
    title: "Task failed: task-123",
    summary: "The strongest signal points to a MiniClaw code/runtime bug.",
    subject_id: "task-123456",
    subject_type: "task",
    source_json: null,
    evidence_json: null,
    diagnosis_json: JSON.stringify({ repairAllowed: true, recommendedAction: "Repair later." }),
    created_at: "2026-05-10T04:00:00.000Z",
    updated_at: "2026-05-10T04:00:00.000Z",
    resolved_at: null,
  };
}

function repairResult(row: IncidentRow): DoctorRepairResult {
  return {
    ok: true,
    dryRun: false,
    incident: row,
    repairRun: {
      id: "repair-123456",
      incident_id: row.id,
      status: "repair_ready",
      workspace_path: "/tmp/miniclaw-repairs/incident-123456",
      branch: "doctor-repair/incident-123456",
      base_sha: null,
      commit_sha: null,
      verification_json: null,
      report_json: null,
      created_at: "2026-05-10T04:01:00.000Z",
      completed_at: "2026-05-10T04:02:00.000Z",
    },
    policy: { allowed: true, blockers: [], warnings: [] },
    workspacePath: "/tmp/miniclaw-repairs/incident-123456",
    branch: "doctor-repair/incident-123456",
    prompt: "repair prompt",
    changedFiles: ["src/fixed.ts"],
    verification: [{ command: "pnpm test", ok: true, output: "passed" }],
    message: "repair is ready for review in isolated worktree",
  };
}

beforeEach(() => {
  vi.resetModules();
  previousEnv = {};
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = previousEnv[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  vi.resetModules();
});

describe("doctor scheduler", () => {
  it("skips when auto diagnose is disabled", async () => {
    process.env.MINICLAW_DOCTOR_AUTO_DIAGNOSE_ENABLED = "false";
    const { createDoctorScheduler } = await import("../doctor-scheduler.js");
    const scheduler = createDoctorScheduler({} as Client, {
      runDoctorFn: vi.fn(async () => reportWithFailedTask()),
    });

    await expect(scheduler.runOnce("test")).resolves.toMatchObject({ skipped: "disabled" });
  });

  it("persists and notifies new incident candidates", async () => {
    process.env.MINICLAW_DOCTOR_AUTO_DIAGNOSE_ENABLED = "true";
    process.env.MINICLAW_DOCTOR_SUMMARY_CHANNEL_ID = "channel-1";
    const { createDoctorScheduler } = await import("../doctor-scheduler.js");
    const row = incidentRow();
    const createOrUpdate = vi.fn(() => ({ row, created: true, severityEscalated: false }));
    const appendEvent = vi.fn(() => 1);
    const notify = vi.fn(async () => undefined);
    const scheduler = createDoctorScheduler({} as Client, {
      runDoctorFn: vi.fn(async () => reportWithFailedTask()),
      createOrUpdateIncidentFn: createOrUpdate,
      appendIncidentEventFn: appendEvent,
      sendNotificationFn: notify,
      drainingFn: () => false,
    });

    const result = await scheduler.runOnce("test");

    expect(createOrUpdate).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: "task:task-123456:failed",
      type: "task_failed",
    }));
    expect(appendEvent).toHaveBeenCalledWith(row.id, "doctor_scan", expect.objectContaining({ reason: "test" }));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(result.created).toEqual([row]);
    expect(result.notified).toEqual([row]);
  });

  it("runs guarded auto repair and posts a repair summary when enabled", async () => {
    process.env.MINICLAW_DOCTOR_AUTO_DIAGNOSE_ENABLED = "true";
    process.env.MINICLAW_DOCTOR_AUTO_REPAIR_ENABLED = "true";
    process.env.MINICLAW_DOCTOR_SUMMARY_CHANNEL_ID = "channel-1";
    const { createDoctorScheduler } = await import("../doctor-scheduler.js");
    const row = incidentRow();
    const repair = repairResult(row);
    const appendEvent = vi.fn(() => 1);
    const runRepair = vi.fn(async () => repair);
    const repairNotify = vi.fn(async () => undefined);
    const scheduler = createDoctorScheduler({} as Client, {
      runDoctorFn: vi.fn(async () => reportWithFailedTask()),
      createOrUpdateIncidentFn: vi.fn(() => ({ row, created: true, severityEscalated: false })),
      appendIncidentEventFn: appendEvent,
      countRepairRunsByStatusFn: vi.fn(() => 0),
      countRepairRunsSinceFn: vi.fn(() => 0),
      sendNotificationFn: vi.fn(async () => undefined),
      sendRepairNotificationFn: repairNotify,
      runRepairFn: runRepair,
      drainingFn: () => false,
      nowFn: () => new Date("2026-05-10T04:30:00.000Z"),
    });

    const result = await scheduler.runOnce("test");

    expect(runRepair).toHaveBeenCalledWith({
      incidentId: row.id,
      dryRun: false,
      execute: true,
      force: false,
      json: false,
    });
    expect(repairNotify).toHaveBeenCalledWith({} as Client, repair);
    expect(appendEvent).toHaveBeenCalledWith(row.id, "repair_notified", expect.objectContaining({
      channel_id: "channel-1",
      repair_run_id: repair.repairRun?.id,
      ok: true,
    }));
    expect(result.repaired).toEqual([repair]);
    expect(result.repairSkipped).toEqual([]);
  });

  it("skips auto repair when the daily repair cap is reached", async () => {
    process.env.MINICLAW_DOCTOR_AUTO_DIAGNOSE_ENABLED = "true";
    process.env.MINICLAW_DOCTOR_AUTO_REPAIR_ENABLED = "true";
    process.env.MINICLAW_DOCTOR_MAX_REPAIRS_PER_DAY = "1";
    const { createDoctorScheduler } = await import("../doctor-scheduler.js");
    const row = incidentRow();
    const appendEvent = vi.fn(() => 1);
    const runRepair = vi.fn();
    const scheduler = createDoctorScheduler({} as Client, {
      runDoctorFn: vi.fn(async () => reportWithFailedTask()),
      createOrUpdateIncidentFn: vi.fn(() => ({ row, created: true, severityEscalated: false })),
      appendIncidentEventFn: appendEvent,
      countRepairRunsByStatusFn: vi.fn(() => 0),
      countRepairRunsSinceFn: vi.fn(() => 1),
      sendNotificationFn: vi.fn(async () => undefined),
      runRepairFn: runRepair,
      drainingFn: () => false,
      nowFn: () => new Date("2026-05-10T04:30:00.000Z"),
    });

    const result = await scheduler.runOnce("test");

    expect(runRepair).not.toHaveBeenCalled();
    expect(result.repaired).toEqual([]);
    expect(result.repairSkipped).toEqual([expect.objectContaining({ incident: row, reason: "max_repairs_per_day" })]);
    expect(appendEvent).toHaveBeenCalledWith(row.id, "repair_skipped", expect.objectContaining({
      reason: "max_repairs_per_day",
    }));
  });
});
