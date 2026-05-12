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
import { runCodexRepairAgent, type RepairAgentResult } from "./doctor-repair/agent.js";
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
import {
  commitVerifiedRepair,
  currentGitSha,
  defaultCommandRunner,
  ensureRepairDependencies,
  prepareRepairWorktree,
  pushRepairBranch,
  repairBranch,
  repairWorkspacePath,
} from "./doctor-repair/worktree.js";

export type { RepairAgentResult } from "./doctor-repair/agent.js";
export type { RepairPolicyResult } from "./doctor-repair/policy.js";
export { parseChangedFiles } from "./doctor-repair/path-policy.js";
export { formatDoctorRepairResult, formatRepairReviewReport } from "./doctor-repair/report.js";
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

export function buildRepairPrompt(incident: IncidentRow): string {
  return buildRepairPromptWithPolicy(incident, {
    allowedPaths: config.doctor.allowedPaths,
    blockedPaths: config.doctor.blockedPaths,
  });
}

export function validateChangedPaths(paths: string[]): string[] {
  return validateChangedPathsWithPolicy(paths, {
    allowedPaths: config.doctor.allowedPaths,
    blockedPaths: config.doctor.blockedPaths,
  });
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
  const workspacePath = repairWorkspacePath(config.doctor.repairWorktreeRoot, incident.id);
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
  prepareRepairWorktree(workspacePath, branch, config.doctor.repairWorktreeRoot, commandRunner);
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
      commitSha = commitVerifiedRepair(
        incident,
        changedFiles,
        workspacePath,
        {
          authorName: config.doctor.repairCommitAuthorName,
          authorEmail: config.doctor.repairCommitAuthorEmail,
        },
        commandRunner,
      );
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
