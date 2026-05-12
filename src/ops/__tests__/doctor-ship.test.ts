import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncidentRow, RepairRunRow } from "../../store/incidents.js";
import type { SafeRestartResult } from "../safe-restart.js";

const ENV_KEYS = [
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_GUILD_ID",
  "MINICLAW_ALLOWED_USER_ID",
  "MINICLAW_CONFIG",
  "MINICLAW_AGENT_PROVIDER",
  "MINICLAW_DEFAULT_CWD",
  "MINICLAW_DB_PATH",
  "MINICLAW_MEMORY_PATH",
  "MINICLAW_DOCTOR_REQUIRE_APPROVAL_FOR_MAIN",
] as const;

let tmp: string;
let previousEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.resetModules();
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-doctor-ship-"));
  previousEnv = {};
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = previousEnv[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  rmSync(tmp, { recursive: true, force: true });
  vi.resetModules();
});

function writeConfig(options: { requireApproval?: boolean } = {}): void {
  const cfg = join(tmp, "config.yaml");
  writeFileSync(cfg, `
discord:
  token: "token-test"
  client_id: "client-test"
  guild_id: "guild-test"
  allowed_user_id: "user-test"
agent:
  provider: codex
  default_cwd: "${tmp}"
storage:
  db_path: "${join(tmp, "data.db")}"
  memory_path: "${join(tmp, "MEMORY.md")}"
doctor:
  require_approval_for_main: ${options.requireApproval ?? true}
`);
  process.env.MINICLAW_CONFIG = cfg;
}

function incident(overrides: Partial<IncidentRow> = {}): IncidentRow {
  return {
    id: "incident-123456",
    dedupe_key: "task:task-1:failed",
    type: "task_failed",
    severity: "warning",
    status: "repair_ready",
    title: "Task failed: task-1",
    summary: "TypeError in MiniClaw routing",
    subject_id: "task-1",
    subject_type: "task",
    source_json: null,
    evidence_json: null,
    diagnosis_json: JSON.stringify({ repairAllowed: true }),
    created_at: "2026-05-10T01:00:00.000Z",
    updated_at: "2026-05-10T01:00:00.000Z",
    resolved_at: null,
    ...overrides,
  };
}

function repairRun(row: IncidentRow, overrides: Partial<RepairRunRow> = {}): RepairRunRow {
  return {
    id: "repair-123456",
    incident_id: row.id,
    status: "repair_pushed",
    workspace_path: join(tmp, "repairs", row.id),
    branch: "doctor-repair/incident-123456",
    base_sha: "base-sha",
    commit_sha: "commit-sha",
    verification_json: null,
    report_json: JSON.stringify({ pushed: true, pushTarget: "origin/doctor-repair/incident-123456" }),
    created_at: "2026-05-10T01:01:00.000Z",
    completed_at: "2026-05-10T01:02:00.000Z",
    ...overrides,
  };
}

function gitRunner(options: { dirty?: boolean } = {}) {
  return vi.fn((cmd: string, args: string[]) => {
    if (cmd === "git" && args.join(" ") === "rev-parse --abbrev-ref HEAD") return "main\n";
    if (cmd === "git" && args.join(" ") === "status --porcelain") return options.dirty ? " M docs/README.md\n" : "";
    if (cmd === "git" && args[0] === "fetch") return "";
    if (cmd === "git" && args.join(" ") === "rev-parse refs/remotes/origin/doctor-repair/incident-123456") {
      return "commit-sha\n";
    }
    if (cmd === "git" && args.join(" ") === "merge --ff-only refs/remotes/origin/doctor-repair/incident-123456") {
      return "Fast-forward\n";
    }
    if (cmd === "git" && args.join(" ") === "rev-parse HEAD") return "commit-sha\n";
    if (cmd === "git" && args.join(" ") === "push origin HEAD:main") return "";
    throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
  });
}

describe("parseDoctorShipArgs", () => {
  it("defaults to dry-run and parses approval/restart flags", async () => {
    writeConfig();
    const { parseDoctorShipArgs } = await import("../doctor-ship.js");

    expect(parseDoctorShipArgs(["--incident", "abc"])).toMatchObject({
      incidentId: "abc",
      dryRun: true,
      execute: false,
      approveMain: false,
      restart: false,
      app: "miniclaw",
    });
    expect(parseDoctorShipArgs(["--incident", "abc", "--execute", "--approve-main", "--restart", "--app", "bot"])).toMatchObject({
      dryRun: false,
      execute: true,
      approveMain: true,
      restart: true,
      app: "bot",
    });
    expect(() => parseDoctorShipArgs(["--incident", "abc", "--dry-run", "--execute"])).toThrow(/mutually exclusive/);
  });
});

describe("runDoctorShip", () => {
  it("plans a pushed repair and reports required main approval", async () => {
    writeConfig({ requireApproval: true });
    const { runDoctorShip } = await import("../doctor-ship.js");
    const row = incident();
    const repair = repairRun(row);
    const commandRunner = vi.fn();
    const appendIncidentEventFn = vi.fn();

    const result = await runDoctorShip(
      { incidentId: row.id, dryRun: true, execute: false, approveMain: false, restart: false, app: "miniclaw", json: false },
      {
        getIncidentFn: () => row,
        getLatestRepairRunForIncidentFn: () => repair,
        commandRunner,
        appendIncidentEventFn,
      }
    );

    expect(result).toMatchObject({ ok: true, status: "approval_required", mainUpdated: false });
    expect(commandRunner).not.toHaveBeenCalled();
    expect(appendIncidentEventFn).not.toHaveBeenCalled();
  });

  it("refuses execute mode without explicit main approval", async () => {
    writeConfig({ requireApproval: true });
    const { runDoctorShip } = await import("../doctor-ship.js");
    const row = incident();
    const repair = repairRun(row);
    const appendIncidentEventFn = vi.fn();

    const result = await runDoctorShip(
      { incidentId: row.id, dryRun: false, execute: true, approveMain: false, restart: false, app: "miniclaw", json: false },
      {
        getIncidentFn: () => row,
        getLatestRepairRunForIncidentFn: () => repair,
        commandRunner: vi.fn(),
        appendIncidentEventFn,
      }
    );

    expect(result).toMatchObject({ ok: false, status: "approval_required" });
    expect(appendIncidentEventFn).toHaveBeenCalledWith(row.id, "ship_approval_required", expect.objectContaining({
      branch: "doctor-repair/incident-123456",
      commit_sha: "commit-sha",
    }));
  });

  it("fast-forwards and pushes main after explicit approval", async () => {
    writeConfig({ requireApproval: true });
    const { runDoctorShip } = await import("../doctor-ship.js");
    const row = incident();
    const repair = repairRun(row);
    const commandRunner = gitRunner();
    const appendIncidentEventFn = vi.fn();
    const markIncidentStatusFn = vi.fn();

    const result = await runDoctorShip(
      { incidentId: row.id, dryRun: false, execute: true, approveMain: true, restart: false, app: "miniclaw", json: false },
      {
        cwd: tmp,
        getIncidentFn: () => row,
        getLatestRepairRunForIncidentFn: () => repair,
        commandRunner,
        appendIncidentEventFn,
        markIncidentStatusFn,
      }
    );

    expect(result).toMatchObject({ ok: true, status: "shipped", mainUpdated: true, restartAttempted: false });
    expect(commandRunner).toHaveBeenCalledWith("git", [
      "fetch",
      "origin",
      "+refs/heads/doctor-repair/incident-123456:refs/remotes/origin/doctor-repair/incident-123456",
    ], tmp);
    expect(commandRunner).toHaveBeenCalledWith("git", ["push", "origin", "HEAD:main"], tmp);
    expect(markIncidentStatusFn).toHaveBeenCalledWith(row.id, "shipped");
    expect(appendIncidentEventFn).toHaveBeenCalledWith(row.id, "repair_main_updated", expect.objectContaining({
      main_sha: "commit-sha",
    }));
  });

  it("defers live restart when safe-restart sees active tasks", async () => {
    writeConfig({ requireApproval: true });
    const { runDoctorShip } = await import("../doctor-ship.js");
    const row = incident();
    const repair = repairRun(row);
    const restartResult: SafeRestartResult = {
      ok: false,
      app: "miniclaw",
      dbPath: join(tmp, "data.db"),
      activeChatStatePath: join(tmp, "active-chats.json"),
      runningTasks: [{
        id: "task-running",
        prompt: "long task",
        cwd: tmp,
        created_at: "2026-05-10T01:00:00.000Z",
        session_id: null,
        discord_thread_id: null,
      }],
      runningChats: [],
      exitCode: 1,
      reason: "running_tasks",
    };
    const appendIncidentEventFn = vi.fn();

    const result = await runDoctorShip(
      { incidentId: row.id, dryRun: false, execute: true, approveMain: true, restart: true, app: "miniclaw", json: false },
      {
        cwd: tmp,
        getIncidentFn: () => row,
        getLatestRepairRunForIncidentFn: () => repair,
        commandRunner: gitRunner(),
        appendIncidentEventFn,
        markIncidentStatusFn: vi.fn(),
        safeRestartFn: vi.fn(async () => restartResult),
      }
    );

    expect(result).toMatchObject({ ok: true, status: "restart_deferred", mainUpdated: true, restartAttempted: true });
    expect(appendIncidentEventFn).toHaveBeenCalledWith(row.id, "live_restart_deferred", expect.objectContaining({
      running_tasks: ["task-running"],
    }));
  });

  it("blocks main update when the live main worktree is dirty", async () => {
    writeConfig({ requireApproval: true });
    const { runDoctorShip } = await import("../doctor-ship.js");
    const row = incident();
    const repair = repairRun(row);
    const markIncidentStatusFn = vi.fn();

    const result = await runDoctorShip(
      { incidentId: row.id, dryRun: false, execute: true, approveMain: true, restart: false, app: "miniclaw", json: false },
      {
        cwd: tmp,
        getIncidentFn: () => row,
        getLatestRepairRunForIncidentFn: () => repair,
        commandRunner: gitRunner({ dirty: true }),
        appendIncidentEventFn: vi.fn(),
        markIncidentStatusFn,
      }
    );

    expect(result).toMatchObject({ ok: false, status: "main_update_failed", mainUpdated: false });
    expect(result.message).toContain("dirty main worktree");
    expect(markIncidentStatusFn).not.toHaveBeenCalled();
  });

  it("blocks ship when the latest repair run was not pushed", async () => {
    writeConfig({ requireApproval: false });
    const { runDoctorShip } = await import("../doctor-ship.js");
    const row = incident();
    const repair = repairRun(row, { status: "repair_ready" });

    const result = await runDoctorShip(
      { incidentId: row.id, dryRun: false, execute: true, approveMain: false, restart: false, app: "miniclaw", json: false },
      {
        getIncidentFn: () => row,
        getLatestRepairRunForIncidentFn: () => repair,
      }
    );

    expect(result).toMatchObject({ ok: false, status: "not_ready" });
    expect(result.message).toContain("status=repair_pushed");
  });
});

describe("formatDoctorShipResult", () => {
  it("renders a reusable repair review with diff, verification, risks, rollback, and ship commands", async () => {
    writeConfig({ requireApproval: true });
    const { formatDoctorShipResult } = await import("../doctor-ship.js");
    const row = incident();
    const repair = repairRun(row, {
      report_json: JSON.stringify({
        changedFiles: ["src/ops/doctor-ship.ts", "docs/features/13-auto-doctor.md"],
        diffSummary: "2 files changed, 45 insertions, 8 deletions",
        blockers: [".env: blocked path"],
        pushError: "token=secret-token-123456 denied",
      }),
      verification_json: JSON.stringify([
        { command: "pnpm run typecheck", ok: true, durationMs: 1200 },
        { command: "pnpm run lint", ok: false, exitCode: 2, durationMs: 900 },
      ]),
    });

    const text = formatDoctorShipResult({
      ok: true,
      status: "approval_required",
      dryRun: true,
      incident: row,
      repairRun: repair,
      branch: repair.branch ?? undefined,
      commitSha: repair.commit_sha ?? undefined,
      mainUpdated: false,
      restartAttempted: false,
      message: "main update requires explicit approval; rerun with --execute --approve-main",
    });

    expect(text).toContain("MiniClaw Doctor Ship: approval_required");
    expect(text).toContain("Diff Summary");
    expect(text).toContain("2 files changed, 45 insertions, 8 deletions");
    expect(text).toContain("- ok exit=0: pnpm run typecheck");
    expect(text).toContain("- failed exit=2: pnpm run lint");
    expect(text).toContain("- blocker: .env: blocked path");
    expect(text).toContain("main update still requires explicit approval");
    expect(text).toContain("pre-ship: do not approve ship");
    expect(text).toContain("pnpm run doctor:ship -- --incident incident-123456 --execute --approve-main --restart");
    expect(text).toContain("token=[REDACTED]");
    expect(text).not.toContain("secret-token-123456");
    expect(text.length).toBeLessThan(1900);
  });
});
