import { beforeAll, describe, expect, it } from "vitest";
import { initDb } from "../../store/db.js";
import { appendIncidentEvent, createOrUpdateIncident, createRepairRun, updateRepairRun } from "../../store/incidents.js";
import { collectRepairMetrics, formatRepairMetrics } from "../doctor-metrics.js";

beforeAll(() => {
  initDb();
});

describe("doctor repair metrics", () => {
  it("summarizes repair outcomes, patch size, gate duration, and promotion blockers", () => {
    const incident = createOrUpdateIncident({
      dedupeKey: `metrics:${Date.now()}:task`,
      type: "task_failed",
      severity: "warning",
      title: "Task failed for metrics",
      diagnosis: { category: "miniclaw_bug" },
    }).row;
    const repair = createRepairRun({
      incidentId: incident.id,
      status: "repairing",
      workspacePath: "/tmp/repair",
      branch: "doctor-repair/metrics",
    });
    updateRepairRun(repair.id, {
      status: "repair_pushed",
      verification: [
        { command: "pnpm run typecheck", ok: true, output: "ok", durationMs: 1200 },
        { command: "pnpm test", ok: true, output: "ok", durationMs: 2800 },
      ],
      report: { changedFiles: ["src/a.ts", "src/b.ts"] },
      completedAt: new Date().toISOString(),
    });
    appendIncidentEvent(incident.id, "repair_main_updated", { main_sha: "abc123" });
    createOrUpdateIncident({
      dedupeKey: `metrics:${Date.now()}:regression`,
      type: "task_failed",
      severity: "warning",
      title: "Task failed after shipped repair",
      diagnosis: { category: "miniclaw_bug" },
    });

    const metrics = collectRepairMetrics({
      sinceDays: 30,
      limit: 100,
      now: new Date(Date.now() + 1000),
    });

    expect(metrics.attempts).toBeGreaterThanOrEqual(1);
    expect(metrics.successful).toBeGreaterThanOrEqual(1);
    expect(metrics.pushed).toBeGreaterThanOrEqual(1);
    expect(metrics.shipped).toBeGreaterThanOrEqual(1);
    expect(metrics.possibleRegressionIncidents).toBeGreaterThanOrEqual(1);
    expect(metrics.byStatus.repair_pushed).toBeGreaterThanOrEqual(1);
    expect(metrics.byIncidentType.task_failed).toBeGreaterThanOrEqual(1);
    expect(metrics.byCategory.miniclaw_bug).toBeGreaterThanOrEqual(1);
    expect(metrics.averageChangedFiles).not.toBeNull();
    expect(metrics.averageGateDurationMs).not.toBeNull();
    expect(metrics.promotion.eligible).toBe(false);
    expect(formatRepairMetrics(metrics)).toContain("Promotion Policy");
  });
});
