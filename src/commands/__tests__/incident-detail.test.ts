import { describe, expect, it } from "vitest";
import { formatIncidentDetail, formatIncidentResolution } from "../incident-detail.js";
import type { IncidentEventRow, IncidentRow, RepairRunRow } from "../../store/incidents.js";

function incident(overrides: Partial<IncidentRow> = {}): IncidentRow {
  return {
    id: "incident-123456",
    dedupe_key: "task:abc:failed",
    type: "task_failed",
    severity: "warning",
    status: "repair_ready",
    title: "Task failed: abc",
    summary: "Discord task failed after context propagation.",
    subject_id: "task-abc",
    subject_type: "task",
    source_json: JSON.stringify({
      task_id: "task-abc",
      channel_id: "channel-1",
      message_url: "https://discord.com/channels/g/c/m",
    }),
    evidence_json: JSON.stringify({
      trace: [{
        task_id: "task-abc",
        event_type: "provider_error",
        severity: "error",
        message: "TypeError: boom",
        created_at: "2026-05-10T01:08:00.000Z",
      }],
    }),
    diagnosis_json: JSON.stringify({
      category: "miniclaw_bug",
      repairAllowed: true,
      recommendedAction: "Review repair branch.",
    }),
    created_at: "2026-05-10T01:00:00.000Z",
    updated_at: "2026-05-10T01:10:00.000Z",
    resolved_at: null,
    ...overrides,
  };
}

function event(overrides: Partial<IncidentEventRow> = {}): IncidentEventRow {
  return {
    id: 1,
    incident_id: "incident-123456",
    event_type: "repair_ready",
    payload_json: JSON.stringify({ repair_run_id: "repair-1" }),
    created_at: "2026-05-10T01:11:00.000Z",
    ...overrides,
  };
}

function repair(overrides: Partial<RepairRunRow> = {}): RepairRunRow {
  return {
    id: "repair-1",
    incident_id: "incident-123456",
    status: "repair_pushed",
    workspace_path: "/tmp/miniclaw-repairs/incident-123456",
    branch: "doctor-repair/incident-123456",
    base_sha: "base-sha",
    commit_sha: "commit-sha",
    verification_json: null,
    report_json: null,
    created_at: "2026-05-10T01:05:00.000Z",
    completed_at: "2026-05-10T01:09:00.000Z",
    ...overrides,
  };
}

describe("incident detail formatting", () => {
  it("renders core incident, source, repair, event, and operator command fields", () => {
    const text = formatIncidentDetail({
      incident: incident(),
      events: [event()],
      repairRuns: [repair()],
    });

    expect(text).toContain("MiniClaw Incident: incident-123456");
    expect(text).toContain("severity/status: warning/repair_ready");
    expect(text).toContain("category: miniclaw_bug");
    expect(text).toContain("message_url: https://discord.com/channels/g/c/m");
    expect(text).toContain("Task Trace");
    expect(text).toContain("error/provider_error");
    expect(text).toContain("doctor-repair/incident-123456");
    expect(text).toContain("repair_ready");
    expect(text).toContain("/incident ship-preview id:incident");
    expect(text).toContain("/incident approve-ship id:incident");
  });

  it("renders resolution summaries", () => {
    expect(formatIncidentResolution("resolved", incident(), "fixed manually")).toContain("fixed manually");
  });
});
