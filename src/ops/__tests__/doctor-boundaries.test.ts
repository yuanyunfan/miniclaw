import { describe, expect, it } from "vitest";
import { diagnoseDoctorEvidence } from "../doctor/diagnosis.js";
import { formatDoctorReport } from "../doctor/report.js";
import { redactSensitive } from "../doctor/redaction.js";
import type { DoctorEvidence, DoctorReport } from "../doctor/types.js";

function baseEvidence(): DoctorEvidence {
  return {
    generatedAt: "2026-05-12T08:00:00.000Z",
    mode: "recent",
    dbPath: "/tmp/miniclaw.db",
    cronStatePath: "/tmp/cron.json",
    connectivityStatePath: "/tmp/connectivity.json",
    taskCandidates: [],
    taskEvents: [],
    cronErrors: [],
    pm2: { app: "miniclaw", found: true, status: "online", restartCount: 0 },
    git: { cwd: "/repo", branch: "main", sha: "abc1234", dirtyFiles: [] },
    connectivity: { status: "discord_ok", consecutive_failures: 0 },
    logs: [],
  };
}

describe("doctor extracted boundaries", () => {
  it("diagnoses task trace code failures as repairable MiniClaw bugs", () => {
    const evidence = baseEvidence();
    evidence.mode = "task";
    evidence.subject = "task-code";
    evidence.task = {
      id: "task-code-123",
      status: "failed",
      prompt: "run task",
      result_summary: "TypeError: Cannot read properties of undefined",
      source_route_type: "task_channel",
    };
    evidence.taskCandidates = [evidence.task];
    evidence.taskEvents = [{
      id: 1,
      task_id: "task-code-123",
      event_type: "provider_error",
      severity: "error",
      message: "TypeError: Cannot read properties of undefined",
      payload_json: null,
      created_at: "2026-05-12T07:59:00.000Z",
    }];

    expect(diagnoseDoctorEvidence(evidence)).toMatchObject({
      incidentType: "task_failed",
      severity: "warning",
      category: "miniclaw_bug",
      repairAllowed: true,
    });
  });

  it("keeps connectivity outages non-repairable and formats trace/log sections", () => {
    const evidence = baseEvidence();
    evidence.connectivity = { status: "discord_down", consecutive_failures: 3 };
    evidence.logs = [{ path: "/tmp/miniclaw-error.log", lines: ["discord delivery failed"] }];
    evidence.taskEvents = [{
      id: 2,
      task_id: "task-discord-123",
      event_type: "discord_delivery_failed",
      severity: "warning",
      message: "Missing Access",
      payload_json: null,
      created_at: "2026-05-12T07:58:00.000Z",
    }];
    const report: DoctorReport = { evidence, diagnosis: diagnoseDoctorEvidence(evidence) };

    expect(report.diagnosis).toMatchObject({
      incidentType: "discord_outage",
      severity: "critical",
      category: "discord",
      repairAllowed: false,
    });
    expect(formatDoctorReport(report)).toContain("Recent matching log lines");
    expect(formatDoctorReport(report)).toContain("Recent task trace events");
  });

  it("redacts common credential patterns at the shared doctor redaction boundary", () => {
    expect(redactSensitive("authorization: Bearer abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz")).toContain(
      "authorization=[redacted]"
    );
    expect(redactSensitive("github_pat_abcdefghijklmnopqrstuvwxyz1234567890")).toBe("[redacted]");
  });
});
