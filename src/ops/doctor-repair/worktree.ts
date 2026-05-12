import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { IncidentRow } from "../../store/incidents.js";
import type { CommandRunner } from "./verification.js";

export interface RepairCommitConfig {
  authorName: string;
  authorEmail: string;
}

export function defaultCommandRunner(cmd: string, args: string[], cwd: string): string {
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

export function sanitizeRepairId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64);
}

export function repairWorkspacePath(root: string, incidentId: string): string {
  return join(root, sanitizeRepairId(incidentId));
}

export function repairBranch(incidentId: string): string {
  return `doctor-repair/${sanitizeRepairId(incidentId).slice(0, 24)}`;
}

export function prepareRepairWorktree(
  workspacePath: string,
  branch: string,
  root: string,
  run: CommandRunner,
  sourceCwd = process.cwd(),
): void {
  mkdirSync(root, { recursive: true });
  if (existsSync(workspacePath)) {
    run("git", ["status", "--short"], workspacePath);
    return;
  }
  run("git", ["worktree", "add", "-B", branch, workspacePath, "HEAD"], sourceCwd);
}

export function ensureRepairDependencies(workspacePath: string, run: CommandRunner): void {
  if (existsSync(join(workspacePath, "node_modules", ".bin", "tsx"))) return;
  run("pnpm", ["install", "--frozen-lockfile"], workspacePath);
}

export function currentGitSha(workspacePath: string, run: CommandRunner): string {
  return run("git", ["rev-parse", "HEAD"], workspacePath).trim();
}

export function buildRepairCommitMessage(incident: IncidentRow): { title: string; body: string } {
  const shortId = sanitizeRepairId(incident.id).slice(0, 8);
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

export function commitVerifiedRepair(
  incident: IncidentRow,
  changedFiles: string[],
  workspacePath: string,
  commitConfig: RepairCommitConfig,
  run: CommandRunner,
): string {
  run("git", ["config", "user.name", commitConfig.authorName], workspacePath);
  run("git", ["config", "user.email", commitConfig.authorEmail], workspacePath);
  run("git", ["add", "--", ...changedFiles], workspacePath);
  const staged = run("git", ["diff", "--cached", "--name-only"], workspacePath).trim();
  if (!staged) throw new Error("no staged repair changes after git add");
  const message = buildRepairCommitMessage(incident);
  run("git", ["commit", "-m", message.title, "-m", message.body], workspacePath);
  return currentGitSha(workspacePath, run);
}

export function pushRepairBranch(branch: string, workspacePath: string, run: CommandRunner): string {
  const ref = `refs/heads/${branch}`;
  run("git", ["push", "origin", `HEAD:${ref}`], workspacePath);
  return `origin/${branch}`;
}
