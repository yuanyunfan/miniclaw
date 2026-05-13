import { describe, expect, it } from "vitest";
import { formatIncidentDetail, formatIncidentResolution } from "../incident-detail.js";
import type { IncidentEventRow, IncidentRow, RepairRunRow } from "../../store/incidents.js";
import type { CronRunRow } from "../../store/cron-runs.js";
import type { TaskTraceModel } from "../../store/task-trace-export.js";

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

function cronRun(overrides: Partial<CronRunRow> = {}): CronRunRow {
  return {
    id: "cron-run-123456",
    job_name: "daily-news",
    job_type: "task",
    status: "failed",
    attempt: 2,
    scheduled_at: "2026-05-10T01:00:00.000Z",
    started_at: "2026-05-10T01:01:00.000Z",
    completed_at: "2026-05-10T01:02:00.000Z",
    duration_ms: 60000,
    task_id: "task-cron-123456",
    incident_id: "incident-123456",
    provider_name: "stock-pulse",
    provider_status: "failed",
    provider_category: "provider_auth",
    error_category: "provider_auth",
    error_message: "session expired",
    alert_message_id: "alert-1",
    alert_channel_id: "channel-1",
    metadata_json: null,
    ...overrides,
  };
}

function taskTraceModel(overrides: Partial<TaskTraceModel> = {}): TaskTraceModel {
  return {
    task: {
      id: "task-abc",
      status: "failed",
      cwd: "/tmp/miniclaw",
      sessionId: "[redacted-session:abcdef123456]",
      durationMs: 2500,
      costUsd: 0.01,
      createdAt: "2026-05-10T01:00:00.000Z",
      completedAt: "2026-05-10T01:08:00.000Z",
      sourceRouteType: "task_channel",
      sourceChannelId: "channel-1",
      sourceThreadId: "thread-1",
      sourceMessageId: "message-1",
      sourceMessageUrl: "https://discord.com/channels/g/c/m",
    },
    events: [
      {
        id: 1,
        eventType: "task_started",
        severity: "info",
        payload: { provider: "codex" },
        redactedPayloadKeys: 0,
        payloadParseError: false,
        createdAt: "2026-05-10T01:00:00.000Z",
        elapsedMs: null,
      },
      {
        id: 2,
        eventType: "provider_error",
        severity: "error",
        message: "Authorization: [REDACTED]",
        payload: { provider: "codex", event_type: "turn.failed" },
        redactedPayloadKeys: 2,
        payloadParseError: false,
        createdAt: "2026-05-10T01:08:00.000Z",
        elapsedMs: 480000,
      },
    ],
    totalEventCount: 5,
    renderedEventCount: 2,
    omittedEventCount: 3,
    generatedAt: "2026-05-10T01:09:00.000Z",
    redactionPolicy: "allowlist",
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
    expect(text).toContain("/task-log id:task-abc");
    expect(text).toContain("/incident ship-preview id:incident");
    expect(text).toContain("/incident approve-ship id:incident");
  });

  it("renders task trace exporter summaries and full-trace commands when provided", () => {
    const text = formatIncidentDetail({
      incident: incident(),
      events: [event()],
      repairRuns: [repair()],
      taskTrace: {
        taskId: "task-abc",
        source: "incident_subject",
        model: taskTraceModel(),
      },
    });

    expect(text).toContain("source: incident subject task=task-abc");
    expect(text).toContain("export: Task trace task-abc (failed) | events=2/5 | cwd=/tmp/miniclaw");
    expect(text).toContain("recent exported events:");
    expect(text).toContain("error/provider_error Authorization: [REDACTED]");
    expect(text).toContain("full trace: /task-log id:task-abc");
    expect(text).toContain("incident evidence slice:");
  });

  it("renders cron links, repair review fields, ship state, restart state, and rollback hints", () => {
    const row = incident({
      type: "cron_failed",
      status: "shipped",
      title: "Cron failed: daily-news",
      subject_type: "cron",
      subject_id: "daily-news",
      source_json: JSON.stringify({
        route: "cron_task",
        provider: "stock-pulse",
        cron_name: "daily-news",
        cron_run_id: "cron-run-123456",
      }),
      evidence_json: JSON.stringify({ logs: ["cron failed"] }),
    });
    const text = formatIncidentDetail({
      incident: row,
      cronRuns: [cronRun()],
      events: [
        event({
          event_type: "live_restart_deferred",
          payload_json: JSON.stringify({ app: "miniclaw", reason: "running_tasks", running_tasks: ["task-running"] }),
          created_at: "2026-05-10T01:20:00.000Z",
        }),
        event({
          event_type: "repair_main_updated",
          payload_json: JSON.stringify({ main_sha: "commit-sha" }),
          created_at: "2026-05-10T01:18:00.000Z",
        }),
        event({
          event_type: "ship_preview_requested",
          payload_json: JSON.stringify({ status: "approval_required" }),
          created_at: "2026-05-10T01:16:00.000Z",
        }),
      ],
      repairRuns: [repair({
        status: "repair_pushed",
        report_json: JSON.stringify({
          changedFiles: ["src/commands/incident-detail.ts"],
          blockers: [".env: blocked path"],
        }),
        verification_json: JSON.stringify([
          { command: "pnpm run typecheck", ok: true, durationMs: 1200 },
          { command: "pnpm run lint", ok: false, durationMs: 800 },
        ]),
      })],
      taskTrace: {
        taskId: "task-cron-123456",
        source: "linked_cron_run",
        error: { code: "no_events", message: "task `task-cr` 没有 trace events" },
      },
    });

    expect(text).toContain("Cron Runs");
    expect(text).toContain("id=cron-run");
    expect(text).toContain("/cron-run id:cron-run");
    expect(text).toContain("source: linked cron run task=task-cro");
    expect(text).toContain("export: unavailable");
    expect(text).toContain("/task-log id:task-cro");
    expect(text).toContain("changed_files: src/commands/incident-detail.ts");
    expect(text).toContain("blockers: .env: blocked path");
    expect(text).toContain("ok: pnpm run typecheck");
    expect(text).toContain("failed: pnpm run lint");
    expect(text).toContain("ship_preview: 2026-05-10T01:16:00.000Z status=approval_required");
    expect(text).toContain("main_sha=commit-sha");
    expect(text).toContain("live_restart_deferred");
    expect(text).toContain("main revert: git revert commit-sha");
    expect(text).toContain("Clear the restart blocker");
  });

  it("renders resolution summaries", () => {
    expect(formatIncidentResolution("resolved", incident(), "fixed manually")).toContain("fixed manually");
  });

  it("redacts diagnostic fields from incident detail output", () => {
    const text = formatIncidentDetail({
      incident: incident({
        summary: "Provider failed with Authorization: Bearer abcdefghijklmnop for user@example.com",
        evidence_json: JSON.stringify({
          trace: [{
            task_id: "task-abc",
            event_type: "provider_error",
            severity: "error",
            message: "session_id=codex:session-1 token=secret-token-123456",
            created_at: "2026-05-10T01:08:00.000Z",
          }],
        }),
      }),
      events: [event({
        payload_json: JSON.stringify({
          repair_run_id: "repair-1",
          cookie: "sid=secret",
          session_id: "codex:session-1",
          account_number: "123456789012",
        }),
      })],
      repairRuns: [repair({ workspace_path: "/tmp/miniclaw-repairs/incident-123456?token=secret-token-123456" })],
    });

    expect(text).toContain("Authorization: [REDACTED]");
    expect(text).toContain("[redacted-email]");
    expect(text).toContain("session_id=[REDACTED]");
    expect(text).toContain("\"session_id\":\"[redacted-session:");
    expect(text).toContain("\"account_number\":\"[redacted-account:");
    expect(text).toContain("\"cookie\":\"[redacted-credential]\"");
    expect(text).toContain("token=[REDACTED]");
    expect(text).not.toContain("secret-token-123456");
    expect(text).not.toContain("codex:session-1");
    expect(text).not.toContain("123456789012");
    expect(text).not.toContain("user@example.com");
    expect(text).not.toContain("sid=secret");
  });
});
