import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import {
  appendIncidentEvent,
  createRepairRun,
  getIncident,
  markIncidentStatus,
  updateRepairRun,
  type IncidentRow,
  type RepairRunRow,
} from "../store/incidents.js";
import {
  codexInput,
  codexThreadOptions,
  formatCodexItemLine,
  getCodexClient,
  withCodexTimeout,
} from "../agent/codex.js";
import {
  evaluateRepairPolicy as evaluateRepairPolicyWithOptions,
  type RepairPolicyResult,
} from "./doctor-repair/policy.js";
import {
  parseChangedFiles,
  validateChangedPaths as validateChangedPathsWithPolicy,
} from "./doctor-repair/path-policy.js";
import { buildRepairPrompt as buildRepairPromptWithPolicy } from "./doctor-repair/prompt.js";
import {
  runVerification,
  type CommandRunner,
  type VerificationResult,
} from "./doctor-repair/verification.js";

export type { RepairPolicyResult } from "./doctor-repair/policy.js";
export { parseChangedFiles } from "./doctor-repair/path-policy.js";
export {
  repairVerificationCommands,
  selectTargetedTestCommands,
} from "./doctor-repair/verification.js";
export type { CommandRunner, VerificationResult } from "./doctor-repair/verification.js";

export interface DoctorRepairArgs {
  incidentId: string;
  dryRun: boolean;
  execute: boolean;
  force: boolean;
  json: boolean;
}

export interface RepairAgentResult {
  success: boolean;
  threadId?: string;
  response: string;
  toolLog: string[];
  error?: string;
}

export interface DoctorRepairResult {
  ok: boolean;
  dryRun: boolean;
  incident: IncidentRow;
  repairRun?: RepairRunRow;
  policy: RepairPolicyResult;
  workspacePath: string;
  branch: string;
  baseSha?: string;
  commitSha?: string;
  pushed?: boolean;
  pushTarget?: string;
  pushError?: string;
  prompt: string;
  changedFiles: string[];
  agent?: RepairAgentResult;
  verification: VerificationResult[];
  message: string;
}

interface DoctorRepairDeps {
  commandRunner?: CommandRunner;
  getIncidentFn?: typeof getIncident;
  createRepairRunFn?: typeof createRepairRun;
  updateRepairRunFn?: typeof updateRepairRun;
  appendIncidentEventFn?: typeof appendIncidentEvent;
  markIncidentStatusFn?: typeof markIncidentStatus;
  runAgentFn?: (prompt: string, cwd: string) => Promise<RepairAgentResult>;
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

function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64);
}

export function parseDoctorRepairArgs(argv: string[]): DoctorRepairArgs {
  const args: Partial<DoctorRepairArgs> = {
    dryRun: false,
    execute: false,
    force: false,
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
    } else if (arg === "--force") {
      args.force = true;
    } else if (arg === "--json") {
      args.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.incidentId) throw new Error("--incident is required");
  if (args.dryRun && args.execute) throw new Error("--dry-run and --execute are mutually exclusive");
  if (!args.dryRun && !args.execute) args.dryRun = true;
  return args as DoctorRepairArgs;
}

export function evaluateRepairPolicy(incident: IncidentRow, execute: boolean, force: boolean): RepairPolicyResult {
  return evaluateRepairPolicyWithOptions(incident, {
    execute,
    force,
    autoRepairEnabled: config.doctor.autoRepairEnabled,
  });
}

function repairWorkspacePath(incidentId: string): string {
  return join(config.doctor.repairWorktreeRoot, sanitizeId(incidentId));
}

function repairBranch(incidentId: string): string {
  return `doctor-repair/${sanitizeId(incidentId).slice(0, 24)}`;
}

export function buildRepairPrompt(incident: IncidentRow): string {
  return buildRepairPromptWithPolicy(incident, {
    allowedPaths: config.doctor.allowedPaths,
    blockedPaths: config.doctor.blockedPaths,
  });
}

function prepareWorktree(path: string, branch: string, run: CommandRunner): void {
  mkdirSync(config.doctor.repairWorktreeRoot, { recursive: true });
  if (existsSync(path)) {
    run("git", ["status", "--short"], path);
    return;
  }
  run("git", ["worktree", "add", "-B", branch, path, "HEAD"], process.cwd());
}

export function validateChangedPaths(paths: string[]): string[] {
  return validateChangedPathsWithPolicy(paths, {
    allowedPaths: config.doctor.allowedPaths,
    blockedPaths: config.doctor.blockedPaths,
  });
}

function ensureRepairDependencies(path: string, run: CommandRunner): void {
  if (existsSync(join(path, "node_modules", ".bin", "tsx"))) return;
  run("pnpm", ["install", "--frozen-lockfile"], path);
}

function currentGitSha(path: string, run: CommandRunner): string {
  return run("git", ["rev-parse", "HEAD"], path).trim();
}

function commitMessage(incident: IncidentRow): { title: string; body: string } {
  const shortId = sanitizeId(incident.id).slice(0, 8);
  return {
    title: `fix: repair MiniClaw incident ${shortId}`,
    body: [
      `Incident: ${incident.id}`,
      `Title: ${incident.title}`,
      "",
      "Co-authored-by: Codex <codex@openai.com>",
    ].join("\n"),
  };
}

function commitVerifiedRepair(incident: IncidentRow, changedFiles: string[], path: string, run: CommandRunner): string {
  run("git", ["config", "user.name", config.doctor.repairCommitAuthorName], path);
  run("git", ["config", "user.email", config.doctor.repairCommitAuthorEmail], path);
  run("git", ["add", "--", ...changedFiles], path);
  const staged = run("git", ["diff", "--cached", "--name-only"], path).trim();
  if (!staged) throw new Error("no staged repair changes after git add");
  const message = commitMessage(incident);
  run("git", ["commit", "-m", message.title, "-m", message.body], path);
  return currentGitSha(path, run);
}

function pushRepairBranch(branch: string, path: string, run: CommandRunner): string {
  const ref = `refs/heads/${branch}`;
  run("git", ["push", "origin", `HEAD:${ref}`], path);
  return `origin/${branch}`;
}

async function runCodexRepairAgent(prompt: string, cwd: string): Promise<RepairAgentResult> {
  const ctrl = new AbortController();
  const timeoutCtrl = withCodexTimeout(ctrl.signal, config.codex.timeoutMs);
  const codex = getCodexClient();
  const thread = codex.startThread(codexThreadOptions("task", cwd));
  const toolLog: string[] = [];
  let response = "";
  let error: string | undefined;
  const { events } = await thread.runStreamed(codexInput(prompt), { signal: timeoutCtrl.signal });

  for await (const event of events) {
    if (timeoutCtrl.signal.aborted) {
      error = `Codex timeout after ${config.codex.timeoutMs}ms`;
      break;
    }
    switch (event.type) {
      case "turn.failed":
        error = event.error.message;
        break;
      case "error":
        error = event.message;
        break;
      case "item.started":
      case "item.updated":
      case "item.completed":
        if (event.item.type === "agent_message") response = event.item.text;
        else {
          const line = formatCodexItemLine(event.item);
          if (line) toolLog.push(line);
        }
        break;
    }
  }

  if (!timeoutCtrl.signal.aborted) timeoutCtrl.abort();
  return {
    success: !error,
    response: response.trim(),
    toolLog,
    ...(thread.id ? { threadId: thread.id } : {}),
    ...(error ? { error } : {}),
  };
}

export async function runDoctorRepair(args: DoctorRepairArgs, deps: DoctorRepairDeps = {}): Promise<DoctorRepairResult> {
  const getIncidentFn = deps.getIncidentFn ?? getIncident;
  const createRepairRunFn = deps.createRepairRunFn ?? createRepairRun;
  const updateRepairRunFn = deps.updateRepairRunFn ?? updateRepairRun;
  const appendIncidentEventFn = deps.appendIncidentEventFn ?? appendIncidentEvent;
  const markIncidentStatusFn = deps.markIncidentStatusFn ?? markIncidentStatus;
  const commandRunner = deps.commandRunner ?? defaultCommandRunner;
  const runAgentFn = deps.runAgentFn ?? runCodexRepairAgent;
  const incident = getIncidentFn(args.incidentId);
  if (!incident) throw new Error(`incident not found: ${args.incidentId}`);

  const policy = evaluateRepairPolicy(incident, args.execute, args.force);
  const workspacePath = repairWorkspacePath(incident.id);
  const branch = repairBranch(incident.id);
  const prompt = buildRepairPrompt(incident);
  let repairRun: RepairRunRow | undefined;
  let agent: RepairAgentResult | undefined;
  let changedFiles: string[] = [];
  let verification: VerificationResult[] = [];
  let baseSha: string | undefined;
  let commitSha: string | undefined;
  let pushed = false;
  let pushTarget: string | undefined;
  let pushError: string | undefined;

  if (args.dryRun) {
    return {
      ok: policy.allowed,
      dryRun: true,
      incident,
      policy,
      workspacePath,
      branch,
      prompt,
      changedFiles,
      verification,
      message: policy.allowed ? "dry run passed policy checks" : `repair blocked: ${policy.blockers.join("; ")}`,
    };
  }

  if (policy.allowed) baseSha = currentGitSha(process.cwd(), commandRunner);
  repairRun = createRepairRunFn({
    incidentId: incident.id,
    status: policy.allowed ? "repairing" : "blocked",
    workspacePath,
    branch,
    baseSha,
  });

  if (!policy.allowed) {
    markIncidentStatusFn(incident.id, "repair_blocked");
    appendIncidentEventFn(incident.id, "repair_blocked", { repair_run_id: repairRun.id, blockers: policy.blockers });
    updateRepairRunFn(repairRun.id, { status: "blocked", report: { blockers: policy.blockers }, completedAt: new Date().toISOString() });
    return {
      ok: false,
      dryRun: false,
      incident,
      repairRun,
      policy,
      workspacePath,
      branch,
      baseSha,
      prompt,
      changedFiles,
      verification,
      message: `repair blocked: ${policy.blockers.join("; ")}`,
    };
  }

  appendIncidentEventFn(incident.id, "repair_started", { repair_run_id: repairRun.id, execute: args.execute });
  prepareWorktree(workspacePath, branch, commandRunner);
  ensureRepairDependencies(workspacePath, commandRunner);
  const dirtyBefore = parseChangedFiles(commandRunner("git", ["status", "--porcelain"], workspacePath));
  if (dirtyBefore.length) {
    markIncidentStatusFn(incident.id, "repair_blocked");
    appendIncidentEventFn(incident.id, "repair_blocked", {
      repair_run_id: repairRun.id,
      reason: "dirty_repair_worktree",
      dirty_files: dirtyBefore,
    });
    updateRepairRunFn(repairRun.id, {
      status: "blocked",
      report: { dirtyFiles: dirtyBefore },
      completedAt: new Date().toISOString(),
    });
    return {
      ok: false,
      dryRun: false,
      incident,
      repairRun,
      policy,
      workspacePath,
      branch,
      baseSha,
      prompt,
      changedFiles: dirtyBefore,
      verification,
      message: `repair worktree is dirty before agent run: ${dirtyBefore.join(", ")}`,
    };
  }

  agent = await runAgentFn(prompt, workspacePath);
  changedFiles = parseChangedFiles(commandRunner("git", ["status", "--porcelain"], workspacePath));
  const pathViolations = validateChangedPaths(changedFiles);
  const repairBlockers = [
    ...(!agent.success ? [`agent failed: ${agent.error ?? "unknown error"}`] : []),
    ...(changedFiles.length === 0 ? ["repair produced no changes"] : []),
    ...(changedFiles.length > config.doctor.maxPatchFiles
      ? [`repair changed ${changedFiles.length} files; max_patch_files=${config.doctor.maxPatchFiles}`]
      : []),
    ...pathViolations,
  ];

  if (repairBlockers.length) {
    markIncidentStatusFn(incident.id, "repair_blocked");
    appendIncidentEventFn(incident.id, "repair_blocked", {
      repair_run_id: repairRun.id,
      blockers: repairBlockers,
      changed_files: changedFiles,
    });
    updateRepairRunFn(repairRun.id, {
      status: "blocked",
      report: { agent, changedFiles, blockers: repairBlockers },
      completedAt: new Date().toISOString(),
    });
    return {
      ok: false,
      dryRun: false,
      incident,
      repairRun,
      policy,
      workspacePath,
      branch,
      baseSha,
      prompt,
      changedFiles,
      agent,
      verification,
      message: `repair blocked: ${repairBlockers.join("; ")}`,
    };
  }

  verification = runVerification(workspacePath, changedFiles, commandRunner);
  const verified = verification.every((result) => result.ok);
  if (!verified) {
    markIncidentStatusFn(incident.id, "repair_blocked");
    updateRepairRunFn(repairRun.id, {
      status: "verification_failed",
      verification,
      report: { agent, changedFiles },
      completedAt: new Date().toISOString(),
    });

    appendIncidentEventFn(incident.id, "repair_verification_failed", {
      repair_run_id: repairRun.id,
      changed_files: changedFiles,
    });

    return {
      ok: false,
      dryRun: false,
      incident,
      repairRun,
      policy,
      workspacePath,
      branch,
      baseSha,
      prompt,
      changedFiles,
      agent,
      verification,
      message: "repair verification failed",
    };
  }

  if (config.doctor.autoCommitEnabled) {
    try {
      commitSha = commitVerifiedRepair(incident, changedFiles, workspacePath, commandRunner);
      appendIncidentEventFn(incident.id, "repair_committed", {
        repair_run_id: repairRun.id,
        commit_sha: commitSha,
        branch,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      markIncidentStatusFn(incident.id, "repair_blocked");
      updateRepairRunFn(repairRun.id, {
        status: "commit_failed",
        verification,
        report: { agent, changedFiles, commitError: message },
        completedAt: new Date().toISOString(),
      });
      appendIncidentEventFn(incident.id, "repair_commit_failed", {
        repair_run_id: repairRun.id,
        message,
      });
      return {
        ok: false,
        dryRun: false,
        incident,
        repairRun,
        policy,
        workspacePath,
        branch,
        baseSha,
        prompt,
        changedFiles,
        agent,
        verification,
        message: `repair commit failed: ${message}`,
      };
    }
  }

  if (commitSha && config.doctor.autoPushEnabled) {
    try {
      pushTarget = pushRepairBranch(branch, workspacePath, commandRunner);
      pushed = true;
      appendIncidentEventFn(incident.id, "repair_branch_pushed", {
        repair_run_id: repairRun.id,
        commit_sha: commitSha,
        branch,
        target: pushTarget,
      });
    } catch (err) {
      pushError = err instanceof Error ? err.message : String(err);
      markIncidentStatusFn(incident.id, "repair_ready");
      updateRepairRunFn(repairRun.id, {
        status: "push_failed",
        commitSha,
        verification,
        report: { agent, changedFiles, commitSha, pushError },
        completedAt: new Date().toISOString(),
      });
      appendIncidentEventFn(incident.id, "repair_push_failed", {
        repair_run_id: repairRun.id,
        commit_sha: commitSha,
        branch,
        message: pushError,
      });
      return {
        ok: false,
        dryRun: false,
        incident,
        repairRun,
        policy,
        workspacePath,
        branch,
        baseSha,
        commitSha,
        pushed,
        pushTarget,
        pushError,
        prompt,
        changedFiles,
        agent,
        verification,
        message: `repair branch push failed: ${pushError}`,
      };
    }
  }

  markIncidentStatusFn(incident.id, "repair_ready");
  updateRepairRunFn(repairRun.id, {
    status: pushed ? "repair_pushed" : "repair_ready",
    commitSha: commitSha ?? null,
    verification,
    report: { agent, changedFiles, commitSha, pushed, pushTarget },
    completedAt: new Date().toISOString(),
  });

  appendIncidentEventFn(incident.id, "repair_ready", {
    repair_run_id: repairRun.id,
    changed_files: changedFiles,
    commit_sha: commitSha,
    pushed,
    push_target: pushTarget,
  });

  return {
    ok: true,
    dryRun: false,
    incident,
    repairRun,
    policy,
    workspacePath,
    branch,
    baseSha,
    commitSha,
    pushed,
    pushTarget,
    prompt,
    changedFiles,
    agent,
    verification,
    message: pushed
      ? "repair committed and pushed to isolated repair branch"
      : commitSha
        ? "repair committed on isolated repair branch and is ready for review"
        : "repair is ready for review in isolated worktree",
  };
}

export function formatDoctorRepairResult(result: DoctorRepairResult): string {
  return [
    `MiniClaw Doctor Repair: ${result.ok ? "ok" : "blocked"}`,
    "",
    `Incident: ${result.incident.id.slice(0, 8)} ${result.incident.title}`,
    `Mode: ${result.dryRun ? "dry-run" : "execute"}`,
    `Workspace: ${result.workspacePath}`,
    `Branch: ${result.branch}`,
    ...(result.baseSha ? [`Base SHA: ${result.baseSha}`] : []),
    ...(result.commitSha ? [`Commit SHA: ${result.commitSha}`] : []),
    ...(result.pushed ? [`Pushed: ${result.pushTarget ?? "yes"}`] : []),
    ...(result.pushError ? [`Push error: ${result.pushError}`] : []),
    `Message: ${result.message}`,
    "",
    "Policy:",
    result.policy.blockers.length ? result.policy.blockers.map((item) => `- blocker: ${item}`).join("\n") : "- allowed",
    ...result.policy.warnings.map((item) => `- warning: ${item}`),
    "",
    "Changed files:",
    ...(result.changedFiles.length ? result.changedFiles.map((file) => `- ${file}`) : ["- (none)"]),
    "",
    "Verification:",
    ...(result.verification.length
      ? result.verification.map((item) => `- ${item.ok ? "ok" : "failed"}: ${item.command}`)
      : ["- (not run)"]),
  ].join("\n");
}
