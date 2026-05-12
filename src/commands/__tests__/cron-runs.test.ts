import Database from "better-sqlite3";
import type { ChatInputCommandInteraction } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDb } from "../../store/connection.js";
import { createCronRun, markCronRunCompleted, markCronRunFailed } from "../../store/cron-runs.js";
import { ensureBaseSchema, runMigrations } from "../../store/schema.js";
import { buildCronRunDetailReply, buildCronRunsReply, normalizeCronRunLimit } from "../cron-runs.js";
import { handleCronRun, handleCronRuns } from "../handlers.js";

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

function seedCronRuns(): void {
  createCronRun({
    id: "run-alpha-success",
    jobName: "alpha-job",
    jobType: "message",
    startedAt: "2026-05-13T01:00:00.000Z",
  });
  markCronRunCompleted("run-alpha-success", {
    completedAt: "2026-05-13T01:00:01.000Z",
  });

  createCronRun({
    id: "run-beta-failed",
    jobName: "beta-job",
    jobType: "task",
    attempt: 2,
    startedAt: "2026-05-13T02:00:00.000Z",
  });
  db.prepare(
    `INSERT INTO tasks (id, discord_thread_id, discord_user_id, prompt, cwd)
     VALUES ('task-beta-123456', '', 'cron', 'prompt', '/tmp')`
  ).run();
  db.prepare(
    `INSERT INTO incidents (id, dedupe_key, type, severity, status, title)
     VALUES ('incident-beta-123456', 'cron:beta-job', 'cron_failed', 'warning', 'diagnosed', 'Cron failed')`
  ).run();
  markCronRunFailed("run-beta-failed", {
    completedAt: "2026-05-13T02:00:03.000Z",
    taskId: "task-beta-123456",
    incidentId: "incident-beta-123456",
    errorCategory: "provider_auth",
    errorMessage: "session expired",
  });
}

function fakeInteraction(options: {
  userId?: string;
  strings?: Record<string, string>;
  integers?: Record<string, number>;
} = {}): ChatInputCommandInteraction & { reply: ReturnType<typeof vi.fn> } {
  const reply = vi.fn(async (_payload: unknown) => undefined);
  const strings = options.strings ?? {};
  const integers = options.integers ?? {};
  return {
    user: { id: options.userId ?? "test-user-id" },
    reply,
    options: {
      getString: vi.fn((name: string, required?: boolean) => {
        const value = strings[name] ?? null;
        if (required && value === null) throw new Error(`missing string option: ${name}`);
        return value;
      }),
      getInteger: vi.fn((name: string) => integers[name] ?? null),
    },
  } as unknown as ChatInputCommandInteraction & { reply: ReturnType<typeof vi.fn> };
}

describe("cron run command helpers", () => {
  it("normalizes Discord list limits", () => {
    expect(normalizeCronRunLimit(undefined)).toBe(10);
    expect(normalizeCronRunLimit(0)).toBe(1);
    expect(normalizeCronRunLimit(99)).toBe(25);
    expect(normalizeCronRunLimit(3.8)).toBe(3);
  });

  it("builds recent run lists with optional job filtering", () => {
    seedCronRuns();

    const all = buildCronRunsReply({ limit: 10 });
    expect(all).toContain("Cron runs (2)");
    expect(all).toContain("beta-job");
    expect(all).toContain("error=provider_auth");

    const alpha = buildCronRunsReply({ jobName: "alpha-job", limit: 10 });
    expect(alpha).toContain("Cron runs (1)");
    expect(alpha).toContain("alpha-job");
    expect(alpha).not.toContain("beta-job");
  });

  it("builds single run detail replies by unique id prefix", () => {
    seedCronRuns();

    const detail = buildCronRunDetailReply("run-beta");
    expect(detail).toContain("Cron run run-beta-failed");
    expect(detail).toContain("provider_auth");
    expect(detail).toContain("/task-log id:task-bet");
    expect(detail).toContain("/incident view id:incident");

    expect(buildCronRunDetailReply("missing")).toBe("❌ cron run not found: missing");
  });
});

describe("cron run slash handlers", () => {
  it("rejects unauthorized users before reading options or DB state", async () => {
    const interaction = fakeInteraction({ userId: "not-allowed" });

    await handleCronRuns(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({ content: "⛔ 无权限", ephemeral: true });
    expect(interaction.options.getString).not.toHaveBeenCalled();
  });

  it("handles recent run list and detail requests", async () => {
    seedCronRuns();
    const listInteraction = fakeInteraction({
      strings: { job: "beta-job" },
      integers: { limit: 5 },
    });
    const detailInteraction = fakeInteraction({
      strings: { id: "run-beta" },
    });

    await handleCronRuns(listInteraction);
    await handleCronRun(detailInteraction);

    expect(listInteraction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining("beta-job"),
      ephemeral: true,
    });
    expect(detailInteraction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining("Cron run run-beta-failed"),
      ephemeral: true,
    });
  });
});
