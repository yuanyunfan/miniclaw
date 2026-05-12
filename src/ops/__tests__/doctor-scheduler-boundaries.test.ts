import { describe, expect, it } from "vitest";
import type { IncidentRow } from "../../store/incidents.js";
import type { DoctorReport } from "../doctor.js";
import type { DoctorIncidentCandidate } from "../doctor-incidents.js";
import { groupDoctorNotifications, normalizeNotificationSignature } from "../doctor-scheduler/grouping.js";
import { formatDoctorNotificationGroups } from "../doctor-scheduler/notifications.js";
import {
  canAttemptRepair,
  dailyRepairLimitSkip,
  parallelRepairLimitSkip,
  repairLimitSkip,
  startOfUtcDayIso,
} from "../doctor-scheduler/repair-policy.js";
import { createDoctorSchedulerState } from "../doctor-scheduler/state.js";

function baseReport(): DoctorReport {
  return {
    evidence: {
      generatedAt: "2026-05-10T04:00:00.000Z",
      mode: "recent",
      dbPath: "/tmp/miniclaw.db",
      cronStatePath: "/tmp/cron-state.json",
      connectivityStatePath: "/tmp/connectivity.json",
      taskCandidates: [],
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
      category: "network",
      title: "Task failed",
      summary: "The strongest signal points to connectivity rather than a code repair.",
      evidenceSummary: ["connectivity=discord_ok failures=0"],
      repairAllowed: false,
      recommendedAction: "Check VPN/proxy/network and Discord reachability before changing code.",
    },
  };
}

function taskCandidate(id: string, resultSummary: string): DoctorIncidentCandidate {
  return {
    dedupeKey: `task:${id}:failed`,
    type: "task_failed",
    severity: "warning",
    title: `Task failed: ${id.slice(0, 8)}`,
    summary: "The strongest signal points to connectivity rather than a code repair.",
    subjectId: id,
    subjectType: "task",
    source: { route: "cron_task" },
    evidence: {
      task: {
        id,
        status: "failed",
        prompt: "nightly task",
        result_summary: resultSummary,
        source_route_type: "cron_task",
      },
      trace: [],
    },
    diagnosis: {
      category: "network",
      repairAllowed: false,
      recommendedAction: "Check VPN/proxy/network and Discord reachability before changing code.",
    },
    notify: true,
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

describe("doctor scheduler grouping boundary", () => {
  it("groups id-heavy repeated task failures by normalized signature", () => {
    expect(normalizeNotificationSignature("Task task:abc12345 failed for request deadbeefcafebabe"))
      .toBe("task task:<hex> failed for request <hex>");

    const report = baseReport();
    const first = taskCandidate(
      "cdcbc955-ffe0-4d73-aca2-db67d72e57bc",
      "stream disconnected for task:cdcbc955-ffe0-4d73-aca2-db67d72e57bc request deadbeefcafebabe",
    );
    const second = taskCandidate(
      "a36bc841-087a-45f2-9d2f-6902a118f002",
      "stream disconnected for task:a36bc841-087a-45f2-9d2f-6902a118f002 request 0123456789abcdef",
    );

    const groups = groupDoctorNotifications([
      { incident: incidentRow({ id: "incident-cdcbc955", subject_id: first.subjectId }), candidate: first },
      { incident: incidentRow({ id: "incident-a36bc841", subject_id: second.subjectId }), candidate: second },
    ], report);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.incident.id)).toEqual(["incident-cdcbc955", "incident-a36bc841"]);
    const text = formatDoctorNotificationGroups(groups, report);
    expect(text).toContain("2 个相似任务失败");
    expect(text).toContain("route=cron_task");
  });
});

describe("doctor scheduler repair policy boundary", () => {
  it("separates eligibility and rate-limit skip reasons", () => {
    const repairable = incidentRow();

    expect(canAttemptRepair(incidentRow({ status: "resolved" }))).toBe("status_not_repairable");
    expect(canAttemptRepair(incidentRow({ diagnosis_json: JSON.stringify({ repairAllowed: false }) }))).toBe("not_repair_allowed");
    expect(canAttemptRepair(repairable)).toBeUndefined();

    expect(parallelRepairLimitSkip(repairable, 2, 2)).toMatchObject({
      reason: "max_parallel_repairs",
      message: "active=2",
    });
    expect(dailyRepairLimitSkip(repairable, 3, 3)).toMatchObject({
      reason: "max_repairs_per_day",
      message: "today=3",
    });
    expect(repairLimitSkip(repairable, {
      activeRepairs: 0,
      maxParallelRepairs: 2,
      repairsToday: 1,
      maxRepairsPerDay: 2,
    })).toBeUndefined();
    expect(startOfUtcDayIso(new Date("2026-05-10T23:59:59.000Z"))).toBe("2026-05-10T00:00:00.000Z");
  });
});

describe("doctor scheduler state boundary", () => {
  it("tracks concurrent runs and interval log fingerprints", () => {
    const state = createDoctorSchedulerState();

    expect(state.isRunning()).toBe(false);
    expect(state.beginRun()).toBe(true);
    expect(state.isRunning()).toBe(true);
    expect(state.beginRun()).toBe(false);
    state.finishRun();
    expect(state.isRunning()).toBe(false);

    expect(state.shouldSkipUnchangedInterval("interval", "logs:v1")).toBe(false);
    state.rememberLogFingerprint("logs:v1");
    expect(state.shouldSkipUnchangedInterval("interval", "logs:v1")).toBe(true);
    expect(state.shouldSkipUnchangedInterval("startup", "logs:v1")).toBe(false);
    expect(state.shouldSkipUnchangedInterval("interval", null)).toBe(false);
  });
});
