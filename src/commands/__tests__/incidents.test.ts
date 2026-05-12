import Database from "better-sqlite3";
import type { ChatInputCommandInteraction } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDb } from "../../store/connection.js";
import { ensureBaseSchema, runMigrations } from "../../store/schema.js";
import { createOrUpdateIncident, createRepairRun } from "../../store/incidents.js";
import { createCronRun, markCronRunFailed } from "../../store/cron-runs.js";
import { buildIncidentListReply, normalizeIncidentListLimit } from "../incidents.js";
import { handleIncident, handleIncidents } from "../handlers.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  setDb(db);
  ensureBaseSchema(db);
  runMigrations(db);
});

afterEach(() => {
  db.close();
});

function seedIncidentList(): { repairReadyId: string; resolvedId: string } {
  const repairReady = createOrUpdateIncident({
    dedupeKey: "incident-command:repair-ready",
    type: "task_failed",
    severity: "critical",
    status: "repair_ready",
    title: "Task failed from command test",
    subjectId: "task-command-123456",
    subjectType: "task",
    source: { route: "task_channel", provider: "codex" },
    diagnosis: { category: "miniclaw_bug", repairAllowed: true },
  }).row;
  createRepairRun({
    incidentId: repairReady.id,
    status: "repair_pushed",
    branch: "doctor-repair/incident-command",
  });

  const resolved = createOrUpdateIncident({
    dedupeKey: "incident-command:resolved",
    type: "cron_failed",
    severity: "warning",
    status: "resolved",
    title: "Resolved cron from command test",
    subjectId: "daily-cron",
    subjectType: "cron",
    source: { route: "cron_task", provider: "stock-pulse" },
    diagnosis: { category: "provider_auth", repairAllowed: false },
  }).row;

  return { repairReadyId: repairReady.id, resolvedId: resolved.id };
}

function fakeInteraction(options: {
  userId?: string;
  strings?: Record<string, string>;
  integers?: Record<string, number>;
  subcommand?: string;
} = {}): ChatInputCommandInteraction & { reply: ReturnType<typeof vi.fn> } {
  const reply = vi.fn(async (_payload: unknown) => undefined);
  const strings = options.strings ?? {};
  const integers = options.integers ?? {};
  return {
    user: { id: options.userId ?? "test-user-id" },
    reply,
    options: {
      getString: vi.fn((name: string) => strings[name] ?? null),
      getInteger: vi.fn((name: string) => integers[name] ?? null),
      getSubcommand: vi.fn(() => options.subcommand ?? "view"),
    },
  } as unknown as ChatInputCommandInteraction & { reply: ReturnType<typeof vi.fn> };
}

describe("incident list command helpers", () => {
  it("normalizes Discord incident list limits", () => {
    expect(normalizeIncidentListLimit(undefined)).toBe(10);
    expect(normalizeIncidentListLimit(0)).toBe(1);
    expect(normalizeIncidentListLimit(99)).toBe(25);
    expect(normalizeIncidentListLimit(3.8)).toBe(3);
  });

  it("formats grouped incident rows with repair state and command hints", () => {
    const text = buildIncidentListReply({
      incidents: [{
        id: "incident-123456",
        dedupe_key: "task:abc:failed",
        type: "task_failed",
        severity: "critical",
        status: "repair_ready",
        title: "Task failed with Authorization: Bearer secret-token-123456",
        summary: null,
        subject_id: "task-abc",
        subject_type: "task",
        source_json: JSON.stringify({ route: "task_channel", provider: "codex" }),
        evidence_json: null,
        diagnosis_json: JSON.stringify({ category: "miniclaw_bug" }),
        created_at: "2026-05-13T01:00:00.000Z",
        updated_at: "2026-05-13T01:05:00.000Z",
        resolved_at: null,
      }],
      total: 1,
      filters: { category: "miniclaw_bug" },
      repairStatuses: new Map([["incident-123456", "repair_pushed"]]),
      now: new Date("2026-05-13T01:10:00.000Z"),
    });

    expect(text).toContain("MiniClaw incidents (1/1 shown)");
    expect(text).toContain("severity: critical=1");
    expect(text).toContain("task_failed repair=repair_pushed updated=5m");
    expect(text).toContain("subject=task:task-abc route=task_channel provider=codex");
    expect(text).toContain("/incident view id:incident");
    expect(text).toContain("Authorization: [REDACTED]");
    expect(text).not.toContain("secret-token-123456");
  });
});

describe("incident list slash handler", () => {
  it("applies slash filters and includes latest repair status", async () => {
    const { repairReadyId, resolvedId } = seedIncidentList();
    const interaction = fakeInteraction({
      strings: {
        category: "miniclaw_bug",
        provider: "codex",
        route: "task_channel",
        repair_status: "repair_pushed",
      },
      integers: { limit: 5 },
    });

    await handleIncidents(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining(repairReadyId.slice(0, 8)),
      ephemeral: true,
    });
    const payload = interaction.reply.mock.calls[0]?.[0] as { content: string };
    const { content } = payload;
    expect(content).toContain("Filters:");
    expect(content).toContain("repair_status=repair_pushed");
    expect(content).toContain("repair=repair_pushed");
    expect(content).not.toContain(resolvedId.slice(0, 8));
  });

  it("wires incident view to linked cron run history", async () => {
    const incident = createOrUpdateIncident({
      dedupeKey: "incident-command:cron-view",
      type: "cron_failed",
      severity: "warning",
      status: "diagnosed",
      title: "Cron failed from view test",
      subjectId: "cron-view-job",
      subjectType: "cron",
      source: { route: "cron_task", provider: "stock-pulse", cron_name: "cron-view-job" },
      diagnosis: { category: "provider_auth", repairAllowed: false },
    }).row;
    createCronRun({
      id: "cron-view-run-123456",
      jobName: "cron-view-job",
      jobType: "task",
      startedAt: "2026-05-13T03:00:00.000Z",
    });
    markCronRunFailed("cron-view-run-123456", {
      completedAt: "2026-05-13T03:00:03.000Z",
      incidentId: incident.id,
      errorCategory: "provider_auth",
      errorMessage: "session expired",
    });

    const interaction = fakeInteraction({
      subcommand: "view",
      strings: { id: incident.id.slice(0, 8) },
    });

    await handleIncident(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining("Cron Runs"),
      ephemeral: true,
    });
    const payload = interaction.reply.mock.calls[0]?.[0] as { content: string };
    expect(payload.content).toContain("id=cron-vie");
    expect(payload.content).toContain("/cron-run id:cron-vie");
  });

  it("rejects unauthorized users before reading incident filters", async () => {
    const interaction = fakeInteraction({ userId: "not-allowed" });

    await handleIncidents(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({ content: "⛔ 无权限", ephemeral: true });
    expect(interaction.options.getString).not.toHaveBeenCalled();
  });
});
