import { execFileSync } from "node:child_process";
import { config } from "../config.js";
import {
  appendIncidentEvent,
  getIncident,
  getLatestRepairRunForIncident,
  markIncidentStatus,
  type IncidentRow,
  type RepairRunRow,
} from "../store/incidents.js";
import { formatRepairReviewReport } from "./doctor-repair/report.js";
import { runSafeRestart, type SafeRestartResult } from "./safe-restart.js";

const DEFAULT_APP_NAME = "miniclaw";

export interface DoctorShipArgs {
  incidentId: string;
  dryRun: boolean;
  execute: boolean;
  approveMain: boolean;
  restart: boolean;
  app: string;
  json: boolean;
}

export type DoctorShipStatus =
  | "planned"
  | "not_ready"
  | "approval_required"
  | "main_update_failed"
  | "shipped"
  | "restart_deferred"
  | "restart_failed"
  | "restarted";

export interface DoctorShipResult {
  ok: boolean;
  status: DoctorShipStatus;
  dryRun: boolean;
  incident: IncidentRow;
  repairRun?: RepairRunRow;
  branch?: string;
  commitSha?: string;
  mainUpdated: boolean;
  restartAttempted: boolean;
  restart?: SafeRestartResult;
  message: string;
}

export type CommandRunner = (cmd: string, args: string[], cwd: string) => string;

interface DoctorShipDeps {
  cwd?: string;
  commandRunner?: CommandRunner;
  getIncidentFn?: typeof getIncident;
  getLatestRepairRunForIncidentFn?: typeof getLatestRepairRunForIncident;
  appendIncidentEventFn?: typeof appendIncidentEvent;
  markIncidentStatusFn?: typeof markIncidentStatus;
  safeRestartFn?: typeof runSafeRestart;
}

function defaultCommandRunner(cmd: string, args: string[], cwd: string): string {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      timeout: 10 * 60 * 1000,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (err) {
    const error = err as Error & { stdout?: Buffer | string; stderr?: Buffer | string };
    const stdout = error.stdout ? String(error.stdout).trim() : "";
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    const detail = [stdout, stderr].filter(Boolean).join("\n");
    throw new Error(detail || error.message);
  }
}

function parseBoolFlagConflict(args: Partial<DoctorShipArgs>): void {
  if (args.dryRun && args.execute) throw new Error("--dry-run and --execute are mutually exclusive");
}

export function parseDoctorShipArgs(argv: string[]): DoctorShipArgs {
  const args: Partial<DoctorShipArgs> = {
    dryRun: false,
    execute: false,
    approveMain: false,
    restart: false,
    app: DEFAULT_APP_NAME,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    } else if (arg === "--incident") {
      const value = argv[++i];
      if (!value) throw new Error("--incident requires an incident id");
      args.incidentId = value;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--execute") {
      args.execute = true;
    } else if (arg === "--approve-main") {
      args.approveMain = true;
    } else if (arg === "--restart") {
      args.restart = true;
    } else if (arg === "--app") {
      const value = argv[++i];
      if (!value) throw new Error("--app requires a PM2 app name");
      args.app = value;
    } else if (arg === "--json") {
      args.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.incidentId) throw new Error("--incident is required");
  parseBoolFlagConflict(args);
  if (!args.dryRun && !args.execute) args.dryRun = true;
  return args as DoctorShipArgs;
}

function isShipReady(repairRun?: RepairRunRow): boolean {
  return Boolean(
    repairRun
    && repairRun.status === "repair_pushed"
    && repairRun.branch
    && repairRun.commit_sha
  );
}

function safeBranchName(branch: string): boolean {
  return /^doctor-repair\/[A-Za-z0-9._/-]+$/.test(branch)
    && !branch.includes("..")
    && !branch.endsWith("/")
    && !branch.includes("//");
}

function remoteRefFor(branch: string): string {
  return `refs/remotes/origin/${branch}`;
}

function updateMainFromRepairBranch(branch: string, commitSha: string, cwd: string, run: CommandRunner): string {
  if (!safeBranchName(branch)) throw new Error(`unsafe repair branch name: ${branch}`);

  const currentBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd).trim();
  if (currentBranch !== "main") throw new Error(`refusing to ship from branch ${currentBranch}; expected main`);

  const dirty = run("git", ["status", "--porcelain"], cwd).trim();
  if (dirty) throw new Error(`refusing to ship with dirty main worktree:\n${dirty}`);

  const remoteRef = remoteRefFor(branch);
  run("git", ["fetch", "origin", `+refs/heads/${branch}:${remoteRef}`], cwd);
  const remoteSha = run("git", ["rev-parse", remoteRef], cwd).trim();
  if (remoteSha !== commitSha) {
    throw new Error(`repair branch head mismatch: expected ${commitSha}, got ${remoteSha}`);
  }

  run("git", ["merge", "--ff-only", remoteRef], cwd);
  const mainSha = run("git", ["rev-parse", "HEAD"], cwd).trim();
  if (mainSha !== commitSha) {
    throw new Error(`main update ended at ${mainSha}, expected ${commitSha}`);
  }
  run("git", ["push", "origin", "HEAD:main"], cwd);
  return mainSha;
}

function notReadyResult(incident: IncidentRow, repairRun: RepairRunRow | undefined, message: string, dryRun: boolean): DoctorShipResult {
  return {
    ok: false,
    status: "not_ready",
    dryRun,
    incident,
    repairRun,
    branch: repairRun?.branch ?? undefined,
    commitSha: repairRun?.commit_sha ?? undefined,
    mainUpdated: false,
    restartAttempted: false,
    message,
  };
}

export async function runDoctorShip(args: DoctorShipArgs, deps: DoctorShipDeps = {}): Promise<DoctorShipResult> {
  const cwd = deps.cwd ?? process.cwd();
  const commandRunner = deps.commandRunner ?? defaultCommandRunner;
  const getIncidentFn = deps.getIncidentFn ?? getIncident;
  const getLatestRepairRunForIncidentFn = deps.getLatestRepairRunForIncidentFn ?? getLatestRepairRunForIncident;
  const appendIncidentEventFn = deps.appendIncidentEventFn ?? appendIncidentEvent;
  const markIncidentStatusFn = deps.markIncidentStatusFn ?? markIncidentStatus;
  const safeRestartFn = deps.safeRestartFn ?? runSafeRestart;

  const incident = getIncidentFn(args.incidentId);
  if (!incident) throw new Error(`incident not found: ${args.incidentId}`);

  const repairRun = getLatestRepairRunForIncidentFn(incident.id);
  if (!isShipReady(repairRun)) {
    return notReadyResult(
      incident,
      repairRun,
      "latest repair run is not pushed; ship requires status=repair_pushed with branch and commit_sha",
      args.dryRun
    );
  }

  const branch = repairRun!.branch!;
  const commitSha = repairRun!.commit_sha!;
  const approvalRequired = config.doctor.requireApprovalForMain && !args.approveMain;

  if (args.dryRun) {
    return {
      ok: true,
      status: approvalRequired ? "approval_required" : "planned",
      dryRun: true,
      incident,
      repairRun,
      branch,
      commitSha,
      mainUpdated: false,
      restartAttempted: false,
      message: approvalRequired
        ? "main update requires explicit approval; rerun with --execute --approve-main"
        : "ship plan is ready; rerun with --execute to update main",
    };
  }

  if (approvalRequired) {
    appendIncidentEventFn(incident.id, "ship_approval_required", {
      repair_run_id: repairRun!.id,
      branch,
      commit_sha: commitSha,
    });
    return {
      ok: false,
      status: "approval_required",
      dryRun: false,
      incident,
      repairRun,
      branch,
      commitSha,
      mainUpdated: false,
      restartAttempted: false,
      message: "main update requires explicit approval; rerun with --approve-main",
    };
  }

  try {
    const mainSha = updateMainFromRepairBranch(branch, commitSha, cwd, commandRunner);
    markIncidentStatusFn(incident.id, "shipped");
    appendIncidentEventFn(incident.id, "repair_main_updated", {
      repair_run_id: repairRun!.id,
      branch,
      commit_sha: commitSha,
      main_sha: mainSha,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendIncidentEventFn(incident.id, "ship_main_update_failed", {
      repair_run_id: repairRun!.id,
      branch,
      commit_sha: commitSha,
      message,
    });
    return {
      ok: false,
      status: "main_update_failed",
      dryRun: false,
      incident,
      repairRun,
      branch,
      commitSha,
      mainUpdated: false,
      restartAttempted: false,
      message: `main update failed: ${message}`,
    };
  }

  if (!args.restart) {
    return {
      ok: true,
      status: "shipped",
      dryRun: false,
      incident,
      repairRun,
      branch,
      commitSha,
      mainUpdated: true,
      restartAttempted: false,
      message: "repair branch fast-forwarded to main and pushed; live restart not requested",
    };
  }

  const restart = await safeRestartFn(
    { app: args.app, force: false, json: true, dbPath: config.dbPath },
    { stdout: () => undefined, stderr: () => undefined }
  );
  if (restart.ok) {
    appendIncidentEventFn(incident.id, "live_restart_completed", {
      repair_run_id: repairRun!.id,
      app: args.app,
      running_tasks: restart.runningTasks.length,
      running_chats: restart.runningChats.length,
    });
    return {
      ok: true,
      status: "restarted",
      dryRun: false,
      incident,
      repairRun,
      branch,
      commitSha,
      mainUpdated: true,
      restartAttempted: true,
      restart,
      message: "repair shipped to main and safe restart completed",
    };
  }

  const deferred = ["running_tasks", "running_chats", "running_work"].includes(restart.reason ?? "");
  appendIncidentEventFn(incident.id, deferred ? "live_restart_deferred" : "live_restart_failed", {
    repair_run_id: repairRun!.id,
    app: args.app,
    reason: restart.reason,
    running_tasks: restart.runningTasks.map((task) => task.id),
    running_chats: restart.runningChats.map((chat) => chat.id),
    exit_code: restart.exitCode,
  });
  return {
    ok: deferred,
    status: deferred ? "restart_deferred" : "restart_failed",
    dryRun: false,
    incident,
    repairRun,
    branch,
    commitSha,
    mainUpdated: true,
    restartAttempted: true,
    restart,
    message: deferred
      ? "repair shipped to main; live restart deferred because active work is still running"
      : `repair shipped to main; safe restart failed with exit code ${restart.exitCode}`,
  };
}

export function formatDoctorShipResult(result: DoctorShipResult): string {
  return formatRepairReviewReport({
    title: `MiniClaw Doctor Ship: ${result.status}`,
    incident: result.incident,
    repairRun: result.repairRun,
    ship: {
      status: result.status,
      dryRun: result.dryRun,
      mainUpdated: result.mainUpdated,
      restartAttempted: result.restartAttempted,
      restart: result.restart,
      message: result.message,
    },
  });
}
