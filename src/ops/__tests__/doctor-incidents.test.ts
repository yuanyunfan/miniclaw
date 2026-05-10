import { describe, expect, it } from "vitest";
import { deriveDoctorIncidentCandidates } from "../doctor-incidents.js";
import type { DoctorReport } from "../doctor.js";

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
      pm2: { app: "miniclaw", found: true, status: "online", restartCount: 3 },
      git: { cwd: "/repo", branch: "main", sha: "abc1234", dirtyFiles: [] },
      connectivity: { status: "discord_ok", consecutive_failures: 0 },
      logs: [],
    },
    diagnosis: {
      incidentType: "unknown",
      severity: "info",
      category: "unknown",
      title: "No clear MiniClaw incident found",
      summary: "No incident.",
      evidenceSummary: ["git=main@abc1234 dirty=0"],
      repairAllowed: false,
      recommendedAction: "Review evidence.",
    },
  };
}

describe("deriveDoctorIncidentCandidates", () => {
  it("creates deterministic task and cron dedupe keys", () => {
    const report = baseReport();
    report.evidence.taskCandidates.push({
      id: "task-123456",
      status: "failed",
      prompt: "fix bug",
      source_route_type: "task_channel",
      source_channel_id: "channel-1",
      source_message_url: "https://discord.com/channels/g/c/m",
    });
    report.evidence.taskEvents.push({
      id: 1,
      task_id: "task-123456",
      event_type: "provider_error",
      severity: "error",
      message: "TypeError: boom",
      payload_json: null,
      created_at: "2026-05-10T03:01:00.000Z",
    });
    report.evidence.cronErrors.push({
      name: "daily-ai-news",
      last_status: "error",
      last_run_at: "2026-05-10T03:00:00.000Z",
      last_error: "boom",
      failure_run_id: "run-1",
    });

    const candidates = deriveDoctorIncidentCandidates(report);

    expect(candidates.map((candidate) => candidate.dedupeKey)).toEqual([
      "task:task-123456:failed",
      "cron:daily-ai-news:run-1",
    ]);
    expect(candidates[0]).toMatchObject({
      type: "task_failed",
      subjectId: "task-123456",
      subjectType: "task",
      notify: true,
      evidence: {
        trace: [expect.objectContaining({ event_type: "provider_error" })],
      },
    });
  });

  it("creates hourly connectivity and PM2 incidents", () => {
    const report = baseReport();
    report.evidence.connectivity = { status: "discord_down", consecutive_failures: 4 };
    report.evidence.pm2 = { app: "miniclaw", found: true, unstableRestarts: 1 };

    const candidates = deriveDoctorIncidentCandidates(report);

    expect(candidates.map((candidate) => candidate.dedupeKey)).toEqual([
      "connectivity:discord_down:2026-05-10T04",
      "pm2:miniclaw:2026-05-10T04",
    ]);
    expect(candidates.every((candidate) => candidate.severity === "critical")).toBe(true);
  });
});
