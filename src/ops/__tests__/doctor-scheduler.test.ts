import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import type { DoctorReport } from "../doctor.js";
import type { IncidentRow } from "../../store/incidents.js";

const ENV_KEYS = [
  "MINICLAW_DOCTOR_ENABLED",
  "MINICLAW_DOCTOR_AUTO_DIAGNOSE_ENABLED",
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
});
