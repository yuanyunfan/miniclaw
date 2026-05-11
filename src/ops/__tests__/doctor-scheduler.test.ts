import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import type { DoctorReport } from "../doctor.js";
import type { DoctorRepairResult } from "../doctor-repair.js";
import type { DoctorNotificationGroup } from "../doctor-scheduler.js";
import type { IncidentRow } from "../../store/incidents.js";

const ENV_KEYS = [
  "MINICLAW_DOCTOR_ENABLED",
  "MINICLAW_DOCTOR_AUTO_DIAGNOSE_ENABLED",
  "MINICLAW_DOCTOR_AUTO_REPAIR_ENABLED",
  "MINICLAW_DOCTOR_MAX_REPAIRS_PER_DAY",
  "MINICLAW_DOCTOR_MAX_PARALLEL_REPAIRS",
  "MINICLAW_DOCTOR_SUMMARY_CHANNEL_ID",
  "MINICLAW_DOCTOR_SUMMARY_CHANNEL_NAME",
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
      taskEvents: [],
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

function incidentRow(overrides: Partial<IncidentRow> = {}): IncidentRow {
  const base: IncidentRow = {
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
  return { ...base, ...overrides };
}

function reportWithRepeatedNetworkTasks(): DoctorReport {
  const error = "Reconnecting... 1/5 (stream disconnected before completion: stream closed before response.completed)";
  return {
    evidence: {
      generatedAt: "2026-05-10T04:00:00.000Z",
      mode: "recent",
      dbPath: "/tmp/miniclaw.db",
      cronStatePath: "/tmp/cron-state.json",
      connectivityStatePath: "/tmp/connectivity.json",
      taskCandidates: [
        {
          id: "cdcbc955-ffe0-4d73-aca2-db67d72e57bc",
          status: "failed",
          prompt: "morning auto improve task 1",
          result_summary: error,
          source_route_type: "cron_task",
        },
        {
          id: "a36bc841-087a-45f2-9d2f-6902a118f002",
          status: "failed",
          prompt: "morning auto improve task 2",
          result_summary: error,
          source_route_type: "cron_task",
        },
      ],
      taskEvents: [
        {
          id: 1,
          task_id: "cdcbc955-ffe0-4d73-aca2-db67d72e57bc",
          event_type: "provider_error",
          severity: "error",
          message: error,
          payload_json: null,
          created_at: "2026-05-10T04:01:00.000Z",
        },
        {
          id: 2,
          task_id: "a36bc841-087a-45f2-9d2f-6902a118f002",
          event_type: "provider_error",
          severity: "error",
          message: error,
          payload_json: null,
          created_at: "2026-05-10T04:02:00.000Z",
        },
      ],
      cronErrors: [],
      pm2: { app: "miniclaw", found: true, status: "online", restartCount: 66 },
      git: { cwd: "/repo", branch: "main", sha: "abc1234", dirtyFiles: [] },
      connectivity: { status: "discord_ok", consecutive_failures: 0 },
      logs: [],
    },
    diagnosis: {
      incidentType: "task_failed",
      severity: "warning",
      category: "network",
      title: "Task failed: cdcbc955",
      summary: "The strongest signal points to connectivity rather than a code repair.",
      evidenceSummary: [
        "task=cdcbc955 status=failed",
        `task_result=${error}`,
        "route=cron_task",
        "connectivity=discord_ok failures=0",
        "pm2=online restarts=66",
      ],
      repairAllowed: false,
      recommendedAction: "Check VPN/proxy/network and Discord reachability before changing code.",
    },
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
  process.env.MINICLAW_DOCTOR_AUTO_REPAIR_ENABLED = "false";
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

  it("skips interval scans when MiniClaw logs have not changed", async () => {
    process.env.MINICLAW_DOCTOR_AUTO_DIAGNOSE_ENABLED = "true";
    const { createDoctorScheduler } = await import("../doctor-scheduler.js");
    const row = incidentRow();
    let fingerprint = "logs:v1";
    const runDoctor = vi.fn(async () => reportWithFailedTask());
    const notify = vi.fn(async () => undefined);
    const scheduler = createDoctorScheduler({} as Client, {
      runDoctorFn: runDoctor,
      createOrUpdateIncidentFn: vi.fn(() => ({ row, created: true, severityEscalated: false })),
      appendIncidentEventFn: vi.fn(() => 1),
      sendNotificationFn: notify,
      drainingFn: () => false,
      logFingerprintFn: () => fingerprint,
    });

    await expect(scheduler.runOnce("interval")).resolves.toMatchObject({ created: [row] });
    await expect(scheduler.runOnce("interval")).resolves.toMatchObject({ skipped: "no_new_logs" });

    fingerprint = "logs:v2";
    await expect(scheduler.runOnce("interval")).resolves.toMatchObject({ created: [row] });
    expect(runDoctor).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("does not skip startup or manual scans when log fingerprint is unchanged", async () => {
    process.env.MINICLAW_DOCTOR_AUTO_DIAGNOSE_ENABLED = "true";
    const { createDoctorScheduler } = await import("../doctor-scheduler.js");
    const row = incidentRow();
    const runDoctor = vi.fn(async () => reportWithFailedTask());
    const scheduler = createDoctorScheduler({} as Client, {
      runDoctorFn: runDoctor,
      createOrUpdateIncidentFn: vi.fn(() => ({ row, created: true, severityEscalated: false })),
      appendIncidentEventFn: vi.fn(() => 1),
      sendNotificationFn: vi.fn(async () => undefined),
      drainingFn: () => false,
      logFingerprintFn: () => "logs:v1",
    });

    await expect(scheduler.runOnce("interval")).resolves.toMatchObject({ created: [row] });
    await expect(scheduler.runOnce("startup")).resolves.toMatchObject({ created: [row] });
    await expect(scheduler.runOnce("manual")).resolves.toMatchObject({ created: [row] });

    expect(runDoctor).toHaveBeenCalledTimes(3);
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

  it("groups repeated task failure notifications by category, route, and error signature", async () => {
    process.env.MINICLAW_DOCTOR_AUTO_DIAGNOSE_ENABLED = "true";
    process.env.MINICLAW_DOCTOR_SUMMARY_CHANNEL_ID = "channel-1";
    const { createDoctorScheduler, __testables } = await import("../doctor-scheduler.js");
    const report = reportWithRepeatedNetworkTasks();
    const rows = new Map<string, IncidentRow>([
      [
        "cdcbc955-ffe0-4d73-aca2-db67d72e57bc",
        incidentRow({
          id: "incident-cdcbc955",
          dedupe_key: "task:cdcbc955-ffe0-4d73-aca2-db67d72e57bc:failed",
          subject_id: "cdcbc955-ffe0-4d73-aca2-db67d72e57bc",
          title: "Task failed: cdcbc955",
          summary: "The strongest signal points to connectivity rather than a code repair.",
          diagnosis_json: JSON.stringify({
            category: "network",
            repairAllowed: false,
            recommendedAction: "Check VPN/proxy/network and Discord reachability before changing code.",
          }),
        }),
      ],
      [
        "a36bc841-087a-45f2-9d2f-6902a118f002",
        incidentRow({
          id: "incident-a36bc841",
          dedupe_key: "task:a36bc841-087a-45f2-9d2f-6902a118f002:failed",
          subject_id: "a36bc841-087a-45f2-9d2f-6902a118f002",
          title: "Task failed: a36bc841",
          summary: "The strongest signal points to connectivity rather than a code repair.",
          diagnosis_json: JSON.stringify({
            category: "network",
            repairAllowed: false,
            recommendedAction: "Check VPN/proxy/network and Discord reachability before changing code.",
          }),
        }),
      ],
    ]);
    const createOrUpdate = vi.fn((candidate) => ({
      row: rows.get(candidate.subjectId ?? "")!,
      created: true,
      severityEscalated: false,
    }));
    const appendEvent = vi.fn(() => 1);
    const notifiedBatches: DoctorNotificationGroup[][] = [];
    const notify = vi.fn(async (_client: Client, groups: DoctorNotificationGroup[]) => {
      notifiedBatches.push(groups);
    });
    const scheduler = createDoctorScheduler({} as Client, {
      runDoctorFn: vi.fn(async () => report),
      createOrUpdateIncidentFn: createOrUpdate,
      appendIncidentEventFn: appendEvent,
      sendNotificationFn: notify,
      drainingFn: () => false,
    });

    const result = await scheduler.runOnce("test");

    expect(notify).toHaveBeenCalledTimes(1);
    const group = notifiedBatches[0]![0]!;
    expect(group.items).toHaveLength(2);
    const text = __testables.formatDoctorNotificationGroup(group, report);
    expect(text).toContain("2 similar task failures");
    expect(text).toContain("Tasks: `cdcbc955`, `a36bc841`");
    expect(text).toContain("Repeated error:");
    expect(text).toContain("stream disconnected");
    expect(result.notified.map((row) => row.id)).toEqual(["incident-cdcbc955", "incident-a36bc841"]);
    expect(appendEvent).toHaveBeenCalledWith("incident-cdcbc955", "doctor_notified", expect.objectContaining({
      grouped: true,
      group_size: 2,
      group_count: 1,
    }));
    expect(appendEvent).toHaveBeenCalledWith("incident-a36bc841", "doctor_notified", expect.objectContaining({
      grouped: true,
      group_size: 2,
      group_count: 1,
    }));
  });

  it("summarizes different task failure signatures in one digest notification", async () => {
    process.env.MINICLAW_DOCTOR_AUTO_DIAGNOSE_ENABLED = "true";
    const { createDoctorScheduler, __testables } = await import("../doctor-scheduler.js");
    const report = reportWithRepeatedNetworkTasks();
    report.evidence.taskCandidates[1]!.result_summary = "TypeError: Cannot read properties of undefined";
    const rows = new Map<string, IncidentRow>([
      ["cdcbc955-ffe0-4d73-aca2-db67d72e57bc", incidentRow({ id: "incident-cdcbc955", subject_id: "cdcbc955-ffe0-4d73-aca2-db67d72e57bc" })],
      ["a36bc841-087a-45f2-9d2f-6902a118f002", incidentRow({ id: "incident-a36bc841", subject_id: "a36bc841-087a-45f2-9d2f-6902a118f002" })],
    ]);
    const notifiedBatches: DoctorNotificationGroup[][] = [];
    const notify = vi.fn(async (_client: Client, groups: DoctorNotificationGroup[]) => {
      notifiedBatches.push(groups);
    });
    const scheduler = createDoctorScheduler({} as Client, {
      runDoctorFn: vi.fn(async () => report),
      createOrUpdateIncidentFn: vi.fn((candidate) => ({
        row: rows.get(candidate.subjectId ?? "")!,
        created: true,
        severityEscalated: false,
      })),
      appendIncidentEventFn: vi.fn(() => 1),
      sendNotificationFn: notify,
      drainingFn: () => false,
    });

    await scheduler.runOnce("test");

    expect(notify).toHaveBeenCalledTimes(1);
    const groups = notifiedBatches[0]!;
    expect(groups).toHaveLength(2);
    const text = __testables.formatDoctorNotificationGroups(groups, report);
    expect(text).toContain("2 incidents in 2 groups");
    expect(text).toContain("Groups:");
    expect(text).toContain("stream disconnected");
    expect(text).toContain("TypeError");
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

  it("includes guarded ship commands when a repair branch was pushed", async () => {
    const { __testables } = await import("../doctor-scheduler.js");
    const row = incidentRow();
    const repair = {
      ...repairResult(row),
      pushed: true,
      pushTarget: "origin/doctor-repair/incident-123456",
      message: "repair committed and pushed to isolated repair branch",
    };

    const text = __testables.formatRepairNotification(repair);

    expect(text).toContain("Ship approval:");
    expect(text).toContain("pnpm run doctor:ship -- --incident incident-123456");
    expect(text).toContain("--execute --approve-main --restart");
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
