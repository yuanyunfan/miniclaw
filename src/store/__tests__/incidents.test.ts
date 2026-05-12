import { beforeAll, describe, expect, it } from "vitest";
import { getDb, initDb } from "../db.js";
import {
  appendIncidentEvent,
  countIncidents,
  countOpenIncidents,
  countRepairRunsByStatus,
  countRepairRunsSince,
  createOrUpdateIncident,
  createRepairRun,
  getIncident,
  getLatestRepairRunForIncident,
  listIncidentEvents,
  listIncidents,
  listIncidentsByIdPrefix,
  listOpenIncidents,
  listRepairRunsForIncident,
  markIncidentStatus,
  updateRepairRun,
} from "../incidents.js";

beforeAll(() => {
  initDb();
});

describe("incidents store", () => {
  it("creates, dedupes, and updates open incidents", () => {
    const first = createOrUpdateIncident({
      dedupeKey: "task:abc:failed",
      type: "task_failed",
      severity: "warning",
      title: "Task failed: abc",
      summary: "first summary",
      subjectId: "abc",
      subjectType: "task",
      source: { task_id: "abc" },
    });

    expect(first.created).toBe(true);
    expect(first.row.status).toBe("diagnosed");
    expect(countOpenIncidents()).toBeGreaterThanOrEqual(1);

    const second = createOrUpdateIncident({
      dedupeKey: "task:abc:failed",
      type: "task_failed",
      severity: "critical",
      title: "Task failed: abc",
      summary: "updated summary",
      subjectId: "abc",
      subjectType: "task",
    });

    expect(second.created).toBe(false);
    expect(second.severityEscalated).toBe(true);
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.severity).toBe("critical");
    expect(second.row.summary).toBe("updated summary");
  });

  it("tracks events and excludes resolved incidents from open counts", () => {
    const incident = createOrUpdateIncident({
      dedupeKey: "cron:daily-news:run-1",
      type: "cron_failed",
      severity: "warning",
      title: "Cron failed: daily-news",
    }).row;

    const eventId = appendIncidentEvent(incident.id, "doctor_scan", { ok: true });
    expect(eventId).toBeGreaterThan(0);
    expect(listIncidentEvents(incident.id, 5)[0]?.event_type).toBe("doctor_scan");

    markIncidentStatus(incident.id, "resolved");
    expect(getIncident(incident.id)?.status).toBe("resolved");
    expect(listOpenIncidents(100).some((row) => row.id === incident.id)).toBe(false);
  });

  it("creates and updates repair runs", () => {
    const incident = createOrUpdateIncident({
      dedupeKey: "task:def:failed",
      type: "task_failed",
      severity: "warning",
      title: "Task failed: def",
    }).row;

    const repair = createRepairRun({
      incidentId: incident.id,
      status: "dry_run",
      workspacePath: "/tmp/repair",
      branch: "doctor-repair/test",
      baseSha: "abc1234",
    });

    updateRepairRun(repair.id, {
      status: "verified",
      commitSha: "def5678",
      verification: { typecheck: "passed" },
      report: { changedFiles: ["src/example.ts"] },
      completedAt: new Date().toISOString(),
    });

    const updated = listOpenIncidents(100).find((row) => row.id === incident.id);
    expect(updated).toBeDefined();
    expect(getLatestRepairRunForIncident(incident.id)?.id).toBe(repair.id);
    expect(countRepairRunsByStatus(["verified"])).toBeGreaterThanOrEqual(1);
    expect(countRepairRunsSince("2020-01-01T00:00:00.000Z")).toBeGreaterThanOrEqual(1);
    expect(listRepairRunsForIncident(incident.id, 5).map((row) => row.id)).toContain(repair.id);
  });

  it("does not downgrade repair lifecycle statuses during hourly rediagnosis", () => {
    const incident = createOrUpdateIncident({
      dedupeKey: "task:repair-ready:failed",
      type: "task_failed",
      severity: "warning",
      title: "Task failed: repair-ready",
    }).row;
    markIncidentStatus(incident.id, "repair_ready");

    const updated = createOrUpdateIncident({
      dedupeKey: "task:repair-ready:failed",
      type: "task_failed",
      severity: "warning",
      status: "diagnosed",
      title: "Task failed: repair-ready",
      summary: "same hourly symptom",
    });

    expect(updated.created).toBe(false);
    expect(updated.row.status).toBe("repair_ready");
    expect(updated.row.summary).toBe("same hourly symptom");
  });

  it("finds incidents by id prefix for operator commands", () => {
    const incident = createOrUpdateIncident({
      dedupeKey: "task:prefix-lookup:failed",
      type: "task_failed",
      severity: "warning",
      title: "Task failed: prefix-lookup",
    }).row;

    expect(listIncidentsByIdPrefix(incident.id.slice(0, 8), 5).some((row) => row.id === incident.id)).toBe(true);
    expect(listIncidentsByIdPrefix("does-not-exist", 5)).toEqual([]);
    expect(listIncidentsByIdPrefix("%", 5)).toEqual([]);
  });

  it("filters incidents by operator fields and sorts critical incidents first", () => {
    const unique = `incident-filter-${Date.now()}`;
    const warning = createOrUpdateIncident({
      dedupeKey: `${unique}:warning`,
      type: "task_failed",
      severity: "warning",
      title: "Warning task failed",
      subjectId: `${unique}-task-warning`,
      subjectType: "task",
      source: { route: "task_channel", provider: "codex" },
      diagnosis: { category: unique, repairAllowed: true },
    }).row;
    const critical = createOrUpdateIncident({
      dedupeKey: `${unique}:critical`,
      type: "task_failed",
      severity: "critical",
      title: "Critical task failed",
      subjectId: `${unique}-task-critical`,
      subjectType: "task",
      source: { route: "task_channel", providerName: "codex" },
      diagnosis: { category: unique, repairAllowed: true },
    }).row;
    const resolved = createOrUpdateIncident({
      dedupeKey: `${unique}:resolved`,
      type: "cron_failed",
      severity: "critical",
      status: "resolved",
      title: "Resolved cron failed",
      subjectId: `${unique}-cron`,
      subjectType: "cron",
      source: { route: "cron_task", provider_name: "stock-pulse" },
      diagnosis: { category: unique, repairAllowed: false },
    }).row;

    createRepairRun({ incidentId: warning.id, status: "blocked" });
    createRepairRun({ incidentId: critical.id, status: "repair_pushed" });
    getDb().prepare("UPDATE incidents SET updated_at = ? WHERE id = ?").run("2026-05-13T01:00:00.000Z", warning.id);
    getDb().prepare("UPDATE incidents SET updated_at = ? WHERE id = ?").run("2026-05-13T00:00:00.000Z", critical.id);

    const openMatches = listIncidents({ category: unique, provider: "codex", route: "task_channel" }, 10);
    expect(openMatches.map((row) => row.id)).toEqual([critical.id, warning.id]);
    expect(openMatches.some((row) => row.id === resolved.id)).toBe(false);

    const repaired = listIncidents({ category: unique, repairStatus: "repair_pushed" }, 10);
    expect(repaired.map((row) => row.id)).toEqual([critical.id]);
    expect(countIncidents({ category: unique })).toBe(2);

    const closed = listIncidents({ status: "resolved", category: unique }, 10);
    expect(closed.map((row) => row.id)).toEqual([resolved.id]);
  });
});
