import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncidentRow, RepairRunRow } from "../../store/incidents.js";

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
  "MINICLAW_DOCTOR_AUTO_REPAIR_ENABLED",
  "MINICLAW_DOCTOR_AUTO_COMMIT_ENABLED",
  "MINICLAW_DOCTOR_AUTO_PUSH_ENABLED",
  "MINICLAW_DOCTOR_MAX_PATCH_FILES",
  "MINICLAW_DOCTOR_REPAIR_WORKTREE_ROOT",
  "MINICLAW_DOCTOR_REPAIR_COMMIT_AUTHOR_NAME",
  "MINICLAW_DOCTOR_REPAIR_COMMIT_AUTHOR_EMAIL",
  "MINICLAW_DOCTOR_ALLOWED_PATHS",
  "MINICLAW_DOCTOR_BLOCKED_PATHS",
] as const;

let tmp: string;
let previousEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.resetModules();
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-doctor-repair-"));
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

function writeConfig(options: { autoRepair?: boolean; autoCommit?: boolean; autoPush?: boolean; maxPatchFiles?: number } = {}): void {
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
  auto_repair_enabled: ${options.autoRepair ?? false}
  auto_commit_enabled: ${options.autoCommit ?? true}
  auto_push_enabled: ${options.autoPush ?? false}
  max_patch_files: ${options.maxPatchFiles ?? 8}
  repair_worktree_root: "${join(tmp, "repairs")}"
  repair_commit_author_name: "yuanyunfan"
  repair_commit_author_email: "59247355+yuanyunfan@users.noreply.github.com"
  allowed_paths:
    - "src/**/*.ts"
    - "docs/**/*.md"
    - "config.example.yaml"
  blocked_paths:
    - ".env"
    - ".env.*"
    - "**/*.db"
    - "**/*.sqlite"
    - "**/*.log"
`);
  process.env.MINICLAW_CONFIG = cfg;
}

function incident(overrides: Partial<IncidentRow> = {}): IncidentRow {
  return {
    id: "incident-123456",
    dedupe_key: "task:task-1:failed",
    type: "task_failed",
    severity: "warning",
    status: "diagnosed",
    title: "Task failed: task-1",
    summary: "TypeError in MiniClaw routing",
    subject_id: "task-1",
    subject_type: "task",
    source_json: JSON.stringify({ task_id: "task-1" }),
    evidence_json: JSON.stringify({ logs: ["TypeError: boom"] }),
    diagnosis_json: JSON.stringify({
      incidentType: "task_failed",
      category: "miniclaw_bug",
      repairAllowed: true,
      recommendedAction: "Patch the MiniClaw bug.",
    }),
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
    status: "repairing",
    workspace_path: join(tmp, "repairs", row.id),
    branch: "doctor-repair/incident-123456",
    base_sha: null,
    commit_sha: null,
    verification_json: null,
    report_json: null,
    created_at: "2026-05-10T01:01:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

describe("parseDoctorRepairArgs", () => {
  it("defaults to dry-run and parses execute flags", async () => {
    writeConfig();
    const { parseDoctorRepairArgs } = await import("../doctor-repair.js");

    expect(parseDoctorRepairArgs(["--incident", "abc"])).toMatchObject({
      incidentId: "abc",
      dryRun: true,
      execute: false,
      force: false,
      json: false,
    });
    expect(parseDoctorRepairArgs(["--incident", "abc", "--execute", "--json"])).toMatchObject({
      incidentId: "abc",
      dryRun: false,
      execute: true,
      json: true,
    });
    expect(() => parseDoctorRepairArgs(["--incident", "abc", "--dry-run", "--execute"])).toThrow(/mutually exclusive/);
  });
});

describe("doctor repair policy", () => {
  it("blocks non-repairable categories and disabled execute mode", async () => {
    writeConfig({ autoRepair: false });
    const { evaluateRepairPolicy } = await import("../doctor-repair.js");
    const authIncident = incident({
      diagnosis_json: JSON.stringify({ category: "provider_auth", repairAllowed: true }),
    });

    expect(evaluateRepairPolicy(authIncident, true, true).blockers).toContain("category provider_auth is not auto-repairable");
    expect(evaluateRepairPolicy(incident(), true, false).blockers).toContain("doctor.auto_repair_enabled is false");
  });

  it("validates allowed and blocked paths with glob semantics", async () => {
    writeConfig();
    const { validateChangedPaths } = await import("../doctor-repair.js");

    expect(validateChangedPaths(["src/fix.ts", "docs/auto-doctor.md", "config.example.yaml"])).toEqual([]);
    expect(validateChangedPaths(["data.db"])).toEqual(["data.db: blocked path"]);
    expect(validateChangedPaths(["logs/miniclaw.log"])).toEqual(["logs/miniclaw.log: blocked path"]);
    expect(validateChangedPaths(["README.md"])).toEqual(["README.md: not in allowed_paths"]);
  });

  it("selects targeted tests from changed files", async () => {
    writeConfig();
    const { selectTargetedTestCommands } = await import("../doctor-repair.js");

    expect(selectTargetedTestCommands(["src/routing/intent.ts"])).toEqual([
      ["pnpm", ["exec", "vitest", "run", "src/routing/__tests__"]],
    ]);
    expect(selectTargetedTestCommands(["src/routing/__tests__/intent.test.ts"])).toEqual([
      ["pnpm", ["exec", "vitest", "run", "src/routing/__tests__/intent.test.ts"]],
    ]);
    expect(selectTargetedTestCommands(["docs/runtime/README.md"])).toEqual([]);
  });
});

describe("runDoctorRepair", () => {
  it("returns a dry-run plan without touching git or DB repair runs", async () => {
    writeConfig();
    const { runDoctorRepair } = await import("../doctor-repair.js");
    const row = incident();
    const commandRunner = vi.fn(() => "");
    const createRepairRunFn = vi.fn(() => repairRun(row));

    const result = await runDoctorRepair(
      { incidentId: row.id, dryRun: true, execute: false, force: false, json: false },
      {
        getIncidentFn: () => row,
        commandRunner,
        createRepairRunFn,
      }
    );

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.workspacePath).toBe(join(tmp, "repairs", row.id));
    expect(result.branch).toBe("doctor-repair/incident-123456");
    expect(result.prompt).toContain("Allowed paths:");
    expect(commandRunner).not.toHaveBeenCalled();
    expect(createRepairRunFn).not.toHaveBeenCalled();
  });

  it("records a blocked repair when execute is disabled by config", async () => {
    writeConfig({ autoRepair: false });
    const { runDoctorRepair } = await import("../doctor-repair.js");
    const row = incident();
    const repair = repairRun(row, { status: "blocked" });
    const commandRunner = vi.fn(() => "");
    const updateRepairRunFn = vi.fn();
    const markIncidentStatusFn = vi.fn();

    const result = await runDoctorRepair(
      { incidentId: row.id, dryRun: false, execute: true, force: false, json: false },
      {
        getIncidentFn: () => row,
        createRepairRunFn: vi.fn(() => repair),
        updateRepairRunFn,
        appendIncidentEventFn: vi.fn(),
        markIncidentStatusFn,
        commandRunner,
      }
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("doctor.auto_repair_enabled is false");
    expect(markIncidentStatusFn).toHaveBeenCalledWith(row.id, "repair_blocked");
    expect(updateRepairRunFn).toHaveBeenCalledWith(repair.id, expect.objectContaining({ status: "blocked" }));
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it("runs the agent in an isolated worktree and verifies a safe patch", async () => {
    writeConfig({ autoRepair: true });
    const { runDoctorRepair } = await import("../doctor-repair.js");
    const row = incident();
    const repair = repairRun(row);
    const updateRepairRunFn = vi.fn();
    const markIncidentStatusFn = vi.fn();
    const appendIncidentEventFn = vi.fn();
    let statusCalls = 0;
    let revParseCalls = 0;
    const commandRunner = vi.fn((cmd: string, args: string[], cwd: string) => {
      if (cmd === "git" && args.join(" ") === "rev-parse HEAD") {
        revParseCalls += 1;
        return revParseCalls === 1 ? "base-sha\n" : "commit-sha\n";
      }
      if (cmd === "git" && args[0] === "worktree") {
        expect(cwd).toBe(process.cwd());
        return "";
      }
      if (cmd === "pnpm" && args.join(" ") === "install --frozen-lockfile") return "installed";
      if (cmd === "git" && args.join(" ") === "status --porcelain") {
        statusCalls += 1;
        return statusCalls === 1 ? "" : " M src/routing/intent.ts\n";
      }
      if (cmd === "pnpm") return `${args.join(" ")} ok`;
      if (cmd === "git" && args[0] === "config") return "";
      if (cmd === "git" && args[0] === "add") return "";
      if (cmd === "git" && args.join(" ") === "diff --cached --name-only") return "src/routing/intent.ts\n";
      if (cmd === "git" && args[0] === "commit") return "[doctor-repair/incident-123456 commit-sha] fix";
      throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
    });
    const runAgentFn = vi.fn(async () => ({
      success: true,
      threadId: "thread-1",
      response: "Fixed the bug.",
      toolLog: ["edited src/fixed.ts"],
    }));

    const result = await runDoctorRepair(
      { incidentId: row.id, dryRun: false, execute: true, force: false, json: false },
      {
        getIncidentFn: () => row,
        createRepairRunFn: vi.fn(() => repair),
        updateRepairRunFn,
        appendIncidentEventFn,
        markIncidentStatusFn,
        commandRunner,
        runAgentFn,
      }
    );

    expect(result.ok).toBe(true);
    expect(result.changedFiles).toEqual(["src/routing/intent.ts"]);
    expect(result.baseSha).toBe("base-sha");
    expect(result.commitSha).toBe("commit-sha");
    expect(result.verification.map((item) => item.command)).toEqual([
      "pnpm run quality:g0",
      "pnpm run quality:secrets",
      "pnpm exec vitest run src/routing/__tests__",
      "pnpm run typecheck",
      "pnpm run lint",
      "pnpm test",
      "pnpm run build",
    ]);
    expect(markIncidentStatusFn).toHaveBeenCalledWith(row.id, "repair_ready");
    expect(updateRepairRunFn).toHaveBeenCalledWith(repair.id, expect.objectContaining({ status: "repair_ready", commitSha: "commit-sha" }));
    expect(appendIncidentEventFn).toHaveBeenCalledWith(row.id, "repair_committed", expect.objectContaining({ commit_sha: "commit-sha" }));
    expect(appendIncidentEventFn).toHaveBeenCalledWith(row.id, "repair_ready", expect.objectContaining({ changed_files: ["src/routing/intent.ts"], commit_sha: "commit-sha" }));
    expect(commandRunner).toHaveBeenCalledWith("git", ["config", "user.name", "yuanyunfan"], result.workspacePath);
    expect(commandRunner).toHaveBeenCalledWith("git", ["config", "user.email", "59247355+yuanyunfan@users.noreply.github.com"], result.workspacePath);
  });

  it("pushes the repair branch when auto push is enabled", async () => {
    writeConfig({ autoRepair: true, autoPush: true });
    const { runDoctorRepair } = await import("../doctor-repair.js");
    const row = incident();
    const repair = repairRun(row);
    const updateRepairRunFn = vi.fn();
    const appendIncidentEventFn = vi.fn();
    let statusCalls = 0;
    let revParseCalls = 0;
    const commandRunner = vi.fn((cmd: string, args: string[]) => {
      if (cmd === "git" && args.join(" ") === "rev-parse HEAD") {
        revParseCalls += 1;
        return revParseCalls === 1 ? "base-sha\n" : "commit-sha\n";
      }
      if (cmd === "git" && args[0] === "worktree") return "";
      if (cmd === "pnpm" && args.join(" ") === "install --frozen-lockfile") return "installed";
      if (cmd === "git" && args.join(" ") === "status --porcelain") {
        statusCalls += 1;
        return statusCalls === 1 ? "" : " M src/routing/intent.ts\n";
      }
      if (cmd === "pnpm") return `${args.join(" ")} ok`;
      if (cmd === "git" && args[0] === "config") return "";
      if (cmd === "git" && args[0] === "add") return "";
      if (cmd === "git" && args.join(" ") === "diff --cached --name-only") return "src/routing/intent.ts\n";
      if (cmd === "git" && args[0] === "commit") return "[doctor-repair/incident-123456 commit-sha] fix";
      if (cmd === "git" && args.join(" ") === "push origin HEAD:refs/heads/doctor-repair/incident-123456") return "pushed";
      throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
    });

    const result = await runDoctorRepair(
      { incidentId: row.id, dryRun: false, execute: true, force: false, json: false },
      {
        getIncidentFn: () => row,
        createRepairRunFn: vi.fn(() => repair),
        updateRepairRunFn,
        appendIncidentEventFn,
        markIncidentStatusFn: vi.fn(),
        commandRunner,
        runAgentFn: vi.fn(async () => ({ success: true, response: "Patched.", toolLog: [] })),
      }
    );

    expect(result.ok).toBe(true);
    expect(result.pushed).toBe(true);
    expect(result.pushTarget).toBe("origin/doctor-repair/incident-123456");
    expect(result.message).toContain("pushed");
    expect(updateRepairRunFn).toHaveBeenCalledWith(repair.id, expect.objectContaining({ status: "repair_pushed", commitSha: "commit-sha" }));
    expect(appendIncidentEventFn).toHaveBeenCalledWith(row.id, "repair_branch_pushed", expect.objectContaining({
      branch: "doctor-repair/incident-123456",
      target: "origin/doctor-repair/incident-123456",
    }));
  });

  it("blocks successful agent output when it touches forbidden paths", async () => {
    writeConfig({ autoRepair: true });
    const { runDoctorRepair } = await import("../doctor-repair.js");
    const row = incident();
    const repair = repairRun(row);
    const updateRepairRunFn = vi.fn();
    const markIncidentStatusFn = vi.fn();
    let statusCalls = 0;
    const commandRunner = vi.fn((cmd: string, args: string[]) => {
      if (cmd === "git" && args.join(" ") === "rev-parse HEAD") return "base-sha\n";
      if (cmd === "git" && args[0] === "worktree") return "";
      if (cmd === "pnpm" && args.join(" ") === "install --frozen-lockfile") return "installed";
      if (cmd === "git" && args.join(" ") === "status --porcelain") {
        statusCalls += 1;
        return statusCalls === 1 ? "" : " M .env\n";
      }
      throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
    });

    const result = await runDoctorRepair(
      { incidentId: row.id, dryRun: false, execute: true, force: false, json: false },
      {
        getIncidentFn: () => row,
        createRepairRunFn: vi.fn(() => repair),
        updateRepairRunFn,
        appendIncidentEventFn: vi.fn(),
        markIncidentStatusFn,
        commandRunner,
        runAgentFn: vi.fn(async () => ({ success: true, response: "Changed env.", toolLog: [] })),
      }
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain(".env: blocked path");
    expect(result.verification).toEqual([]);
    expect(markIncidentStatusFn).toHaveBeenCalledWith(row.id, "repair_blocked");
    expect(updateRepairRunFn).toHaveBeenCalledWith(repair.id, expect.objectContaining({ status: "blocked" }));
  });

  it("records verification failure and does not commit", async () => {
    writeConfig({ autoRepair: true });
    const { runDoctorRepair } = await import("../doctor-repair.js");
    const row = incident();
    const repair = repairRun(row);
    const updateRepairRunFn = vi.fn();
    const markIncidentStatusFn = vi.fn();
    let statusCalls = 0;
    const commandRunner = vi.fn((cmd: string, args: string[]) => {
      if (cmd === "git" && args.join(" ") === "rev-parse HEAD") return "base-sha\n";
      if (cmd === "git" && args[0] === "worktree") return "";
      if (cmd === "pnpm" && args.join(" ") === "install --frozen-lockfile") return "installed";
      if (cmd === "git" && args.join(" ") === "status --porcelain") {
        statusCalls += 1;
        return statusCalls === 1 ? "" : " M src/routing/intent.ts\n";
      }
      if (cmd === "pnpm" && args.join(" ") === "run quality:g0") return "g0 ok";
      if (cmd === "pnpm" && args.join(" ") === "run quality:secrets") return "secrets ok";
      if (cmd === "pnpm" && args.join(" ") === "exec vitest run src/routing/__tests__") return "targeted ok";
      if (cmd === "pnpm" && args.join(" ") === "run typecheck") throw new Error("typecheck failed");
      throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
    });

    const result = await runDoctorRepair(
      { incidentId: row.id, dryRun: false, execute: true, force: false, json: false },
      {
        getIncidentFn: () => row,
        createRepairRunFn: vi.fn(() => repair),
        updateRepairRunFn,
        appendIncidentEventFn: vi.fn(),
        markIncidentStatusFn,
        commandRunner,
        runAgentFn: vi.fn(async () => ({ success: true, response: "Patched.", toolLog: [] })),
      }
    );

    expect(result.ok).toBe(false);
    expect(result.message).toBe("repair verification failed");
    expect(result.verification.at(-1)).toMatchObject({ command: "pnpm run typecheck", ok: false });
    expect(markIncidentStatusFn).toHaveBeenCalledWith(row.id, "repair_blocked");
    expect(updateRepairRunFn).toHaveBeenCalledWith(repair.id, expect.objectContaining({ status: "verification_failed" }));
    expect(commandRunner).not.toHaveBeenCalledWith("git", expect.arrayContaining(["commit"]), expect.any(String));
  });
});
