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

export interface DoctorRepairArgs {
  incidentId: string;
  dryRun: boolean;
  execute: boolean;
  force: boolean;
  json: boolean;
}

export interface RepairPolicyResult {
  allowed: boolean;
  blockers: string[];
  warnings: string[];
}

export interface RepairAgentResult {
  success: boolean;
  threadId?: string;
  response: string;
  toolLog: string[];
  error?: string;
}

export interface VerificationResult {
  command: string;
  ok: boolean;
  output: string;
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
  prompt: string;
  changedFiles: string[];
  agent?: RepairAgentResult;
  verification: VerificationResult[];
  message: string;
}

export type CommandRunner = (cmd: string, args: string[], cwd: string) => string;

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

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function booleanField(obj: Record<string, unknown>, key: string): boolean | undefined {
  return typeof obj[key] === "boolean" ? obj[key] : undefined;
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
  const diagnosis = parseJsonObject(incident.diagnosis_json);
  const category = stringField(diagnosis, "category");
  const repairAllowed = booleanField(diagnosis, "repairAllowed") === true;
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (["resolved", "ignored"].includes(incident.status)) blockers.push(`incident status is ${incident.status}`);
  if (!repairAllowed && !force) blockers.push("diagnosis does not allow repair");
  if (["provider_auth", "provider_data", "network", "discord", "third_party"].includes(category ?? "")) {
    blockers.push(`category ${category} is not auto-repairable`);
  }
  if (!["task_failed", "cron_failed", "chat_error"].includes(incident.type) && !force) {
    blockers.push(`incident type ${incident.type} is not repairable by policy`);
  }
  if (execute && !config.doctor.autoRepairEnabled && !force) {
    blockers.push("doctor.auto_repair_enabled is false");
  }
  if (force) warnings.push("--force bypasses repairAllowed/type/config gates but not path verification");

  return { allowed: blockers.length === 0, blockers, warnings };
}

function repairWorkspacePath(incidentId: string): string {
  return join(config.doctor.repairWorktreeRoot, sanitizeId(incidentId));
}

function repairBranch(incidentId: string): string {
  return `doctor-repair/${sanitizeId(incidentId).slice(0, 24)}`;
}

export function buildRepairPrompt(incident: IncidentRow): string {
  return [
    "You are MiniClaw Self-Repair Worker.",
    "",
    "Goal: produce the smallest safe code fix for the incident below in this isolated worktree.",
    "",
    "Rules:",
    "- Do not edit secrets, credentials, cookies, sessions, runtime DBs, logs, or user config.",
    "- Keep changes within the configured allowed paths.",
    "- Add or update focused tests when the bug is testable.",
    "- Run targeted verification and report exact commands.",
    "- Do not restart MiniClaw, push to main, force-push, or modify the original worktree.",
    "",
    "Incident:",
    JSON.stringify({
      id: incident.id,
      type: incident.type,
      severity: incident.severity,
      status: incident.status,
      title: incident.title,
      summary: incident.summary,
      subject_id: incident.subject_id,
      subject_type: incident.subject_type,
      source: parseJsonObject(incident.source_json),
      evidence: parseJsonObject(incident.evidence_json),
      diagnosis: parseJsonObject(incident.diagnosis_json),
    }, null, 2),
    "",
    "Allowed paths:",
    ...config.doctor.allowedPaths.map((path) => `- ${path}`),
    "",
    "Blocked paths:",
    ...config.doctor.blockedPaths.map((path) => `- ${path}`),
  ].join("\n");
}

function prepareWorktree(path: string, branch: string, run: CommandRunner): void {
  mkdirSync(config.doctor.repairWorktreeRoot, { recursive: true });
  if (existsSync(path)) {
    run("git", ["status", "--short"], path);
    return;
  }
  run("git", ["worktree", "add", "-B", branch, path, "HEAD"], process.cwd());
}

function parseChangedFiles(status: string): string[] {
  return status
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const raw = line.slice(3).trim();
      return raw.includes(" -> ") ? raw.split(" -> ").pop()!.trim() : raw;
    });
}

function normalizeGlobPath(value: string): string {
  return value.replace(/^~\//, "").replace(/^\.\//, "");
}

function escapeRegexChar(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeGlobPath(pattern);
  let out = "^";
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];
    const afterNext = normalized[i + 2];

    if (char === "*" && next === "*" && afterNext === "/") {
      out += "(?:.*/)?";
      i += 2;
    } else if (char === "*" && next === "*") {
      out += ".*";
      i += 1;
    } else if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += escapeRegexChar(char);
    }
  }
  out += "$";
  return new RegExp(out);
}

function matchesPattern(pattern: string, path: string): boolean {
  return globToRegExp(pattern).test(normalizeGlobPath(path));
}

export function validateChangedPaths(paths: string[]): string[] {
  const violations: string[] = [];
  for (const path of paths) {
    if (config.doctor.blockedPaths.some((pattern) => matchesPattern(pattern, path))) {
      violations.push(`${path}: blocked path`);
      continue;
    }
    if (!config.doctor.allowedPaths.some((pattern) => matchesPattern(pattern, path))) {
      violations.push(`${path}: not in allowed_paths`);
    }
  }
  return violations;
}

type VerificationCommand = [cmd: string, args: string[]];

function normalizeRepoPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function hasTestSuffix(path: string): boolean {
  return /(?:^|\/)__tests__\/.*\.(?:test|spec)\.ts$/.test(path) || /\.(?:test|spec)\.ts$/.test(path);
}

export function selectTargetedTestCommands(paths: string[]): VerificationCommand[] {
  const normalizedPaths = paths.map(normalizeRepoPath);
  const directTestFiles = normalizedPaths.filter(hasTestSuffix).sort();
  if (directTestFiles.length) {
    return [["pnpm", ["exec", "vitest", "run", ...directTestFiles]]];
  }

  const targets = new Set<string>();
  for (const path of normalizedPaths) {
    if (path.startsWith("src/routing/")) targets.add("src/routing/__tests__");
    else if (path.startsWith("src/discord/")) targets.add("src/discord/__tests__");
    else if (path.startsWith("src/cron/")) targets.add("src/cron/__tests__");
    else if (path.startsWith("src/ops/")) targets.add("src/ops/__tests__");
    else if (path.startsWith("src/store/")) targets.add("src/store/__tests__");
    else if (path.startsWith("src/agent/")) targets.add("src/agent/__tests__");
    else {
      const provider = path.match(/^src\/providers\/([^/]+)\//)?.[1];
      const mcp = path.match(/^src\/mcp\/([^/]+)\//)?.[1];
      if (provider) targets.add(`src/providers/${provider}/__tests__`);
      if (mcp) targets.add(`src/mcp/${mcp}/__tests__`);
    }
  }

  return targets.size ? [["pnpm", ["exec", "vitest", "run", ...[...targets].sort()]]] : [];
}

function repairVerificationCommands(changedFiles: string[]): VerificationCommand[] {
  return [
    ["pnpm", ["run", "quality:g0"]],
    ["pnpm", ["run", "quality:secrets"]],
    ...selectTargetedTestCommands(changedFiles),
    ["pnpm", ["run", "typecheck"]],
    ["pnpm", ["run", "lint"]],
    ["pnpm", ["test"]],
    ["pnpm", ["run", "build"]],
  ];
}

function runVerification(path: string, changedFiles: string[], run: CommandRunner): VerificationResult[] {
  const results: VerificationResult[] = [];
  for (const [cmd, args] of repairVerificationCommands(changedFiles)) {
    const label = [cmd, ...args].join(" ");
    try {
      const output = run(cmd, args, path);
      results.push({ command: label, ok: true, output: output.slice(-4000) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ command: label, ok: false, output: message.slice(-4000) });
      break;
    }
  }
  return results;
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

  markIncidentStatusFn(incident.id, "repair_ready");
  updateRepairRunFn(repairRun.id, {
    status: "repair_ready",
    commitSha: commitSha ?? null,
    verification,
    report: { agent, changedFiles, commitSha },
    completedAt: new Date().toISOString(),
  });

  appendIncidentEventFn(incident.id, "repair_ready", {
    repair_run_id: repairRun.id,
    changed_files: changedFiles,
    commit_sha: commitSha,
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
    prompt,
    changedFiles,
    agent,
    verification,
    message: commitSha
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
