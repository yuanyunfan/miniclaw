import { formatDiagnosticValue } from "../../privacy/diagnostic-redaction.js";
import type { IncidentRow, RepairRunRow } from "../../store/incidents.js";

interface RepairReportResult {
  ok: boolean;
  dryRun: boolean;
  incident: {
    id: string;
    title: string;
  };
  policy: {
    blockers: readonly string[];
    warnings: readonly string[];
  };
  workspacePath: string;
  branch: string;
  baseSha?: string;
  commitSha?: string;
  pushed?: boolean;
  pushTarget?: string;
  pushError?: string;
  changedFiles: readonly string[];
  verification: readonly {
    ok: boolean;
    command: string;
  }[];
  message: string;
}

export interface RepairReviewShipState {
  status: string;
  dryRun: boolean;
  mainUpdated: boolean;
  restartAttempted: boolean;
  restart?: {
    ok: boolean;
    reason?: string;
    runningTasks: readonly unknown[];
    runningChats: readonly unknown[];
    exitCode?: number;
  };
  message: string;
}

export interface RepairReviewReportInput {
  title?: string;
  incident: Pick<IncidentRow, "id" | "title" | "status" | "severity" | "type">;
  repairRun?: RepairRunRow;
  ship?: RepairReviewShipState;
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function safeText(value: unknown, maxChars = 180): string {
  return formatDiagnosticValue(value, { maxChars });
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function firstStringField(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = stringField(record, key);
    if (value) return value;
  }
  return undefined;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function firstStringArray(record: Record<string, unknown>, keys: readonly string[]): string[] {
  for (const key of keys) {
    const value = stringArrayField(record, key);
    if (value.length) return value;
  }
  return [];
}

function changedPathSummary(paths: readonly string[]): string {
  if (!paths.length) return "not recorded";
  const groups = new Map<string, number>();
  for (const path of paths) {
    const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
    const key = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0] ?? path;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const grouped = [...groups.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([key, count]) => `${key}=${count}`)
    .join(", ");
  return `${paths.length} changed path(s)${grouped ? ` (${grouped})` : ""}`;
}

function verificationReviewLines(verification: unknown[]): string[] {
  if (!verification.length) return ["- not recorded"];
  return verification.slice(0, 8).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return `- unknown: ${safeText(item, 160)}`;
    }
    const row = item as Record<string, unknown>;
    const ok = row.ok === true ? "ok" : row.ok === false ? "failed" : "unknown";
    const rawExit = Number(row.exitCode ?? row.exit_code);
    const exit = Number.isFinite(rawExit)
      ? ` exit=${rawExit}`
      : row.ok === true
        ? " exit=0"
        : row.ok === false
          ? " exit=1"
          : "";
    const duration = typeof row.durationMs === "number"
      ? ` duration=${Math.round(row.durationMs)}ms`
      : typeof row.duration_ms === "number"
        ? ` duration=${Math.round(row.duration_ms)}ms`
        : "";
    return `- ${ok}${exit}: ${safeText(row.command, 160)}${duration}`;
  });
}

function pathPolicyLines(params: {
  blockers: readonly string[];
  dirtyFiles: readonly string[];
}): string[] {
  const pathBlockers = params.blockers.filter((item) =>
    /\b(blocked path|not in allowed_paths|max_patch_files|dirty_repair_worktree)\b/.test(item)
  );
  const lines = [
    ...params.dirtyFiles.map((file) => `- dirty: ${safeText(file, 120)}`),
    ...pathBlockers.map((item) => `- blocker: ${safeText(item, 160)}`),
  ];
  return lines.length ? lines : ["- no path blockers recorded"];
}

function riskLines(params: {
  repairRun?: RepairRunRow;
  verification: readonly unknown[];
  blockers: readonly string[];
  errors: readonly string[];
  changedFiles: readonly string[];
  ship?: RepairReviewShipState;
}): string[] {
  const risks: string[] = [];
  if (!params.repairRun) {
    risks.push("latest repair run is missing");
  } else if (params.repairRun.status !== "repair_pushed") {
    risks.push(`latest repair status is ${params.repairRun.status}; ship requires repair_pushed`);
  }
  if (!params.changedFiles.length) risks.push("changed files were not recorded");
  if (!params.verification.length) risks.push("verification commands were not recorded");
  if (params.verification.some((item) => (
    item && typeof item === "object" && !Array.isArray(item) && (item as Record<string, unknown>).ok === false
  ))) {
    risks.push("one or more verification commands failed");
  }
  if (params.blockers.length) risks.push("repair blockers are recorded");
  if (params.errors.length) risks.push("commit or push errors are recorded");
  if (params.ship?.status === "approval_required") risks.push("main update still requires explicit approval");
  if (params.ship?.status === "main_update_failed") risks.push("main fast-forward/push failed");
  if (params.ship?.status === "restart_deferred") risks.push("safe restart was deferred by active work");
  if (params.ship?.status === "restart_failed") risks.push("safe restart failed after main update");
  return risks.length ? risks.map((risk) => `- ${risk}`) : ["- no additional risks recorded; still review the branch before approval"];
}

function rollbackLine(repairRun: RepairRunRow | undefined, ship: RepairReviewShipState | undefined): string {
  if (!repairRun?.commit_sha) return "no repair commit recorded; keep the incident open or resolve manually";
  if (ship?.mainUpdated) {
    return `git revert ${repairRun.commit_sha}; git push origin main; then run pnpm safe-restart after verification`;
  }
  return `pre-ship: do not approve ship; replace or delete ${repairRun.branch ?? "the repair branch"}; no main revert needed`;
}

function commandLines(incidentId: string): string[] {
  const short = shortId(incidentId);
  return [
    `- Local preview: pnpm run doctor:ship -- --incident ${incidentId}`,
    `- Ship main: pnpm run doctor:ship -- --incident ${incidentId} --execute --approve-main`,
    `- Ship + safe restart: pnpm run doctor:ship -- --incident ${incidentId} --execute --approve-main --restart`,
    `- Discord preview/approve: /incident ship-preview id:${short} ; /incident approve-ship id:${short} restart:false`,
  ];
}

export function formatRepairReviewReport(input: RepairReviewReportInput): string {
  const report = parseJsonObject(input.repairRun?.report_json ?? null);
  const verification = parseJsonArray(input.repairRun?.verification_json ?? null);
  const allChangedFiles = firstStringArray(report, ["changedFiles", "changed_files", "changedPaths", "changed_paths"]);
  const changedFiles = allChangedFiles.slice(0, 6);
  const dirtyFiles = firstStringArray(report, ["dirtyFiles", "dirty_files"]).slice(0, 5);
  const allBlockers = firstStringArray(report, ["blockers", "shipBlockers", "ship_blockers"]);
  const blockers = allBlockers.slice(0, 5);
  const diffSummary = firstStringField(report, ["diffSummary", "diff_summary"]) ?? changedPathSummary(allChangedFiles);
  const errors = [
    firstStringField(report, ["commitError", "commit_error"]),
    firstStringField(report, ["pushError", "push_error"]),
  ].filter((item): item is string => Boolean(item));
  const omittedChangedFileCount = Math.max(0, allChangedFiles.length - changedFiles.length);

  const lines = [
    input.title ?? "MiniClaw Repair Review",
    "",
    "Incident",
    `- id/title: ${shortId(input.incident.id)} ${safeText(input.incident.title, 160)}`,
    `- type/severity/status: ${safeText(input.incident.type, 80)} / ${safeText(input.incident.severity, 40)} / ${safeText(input.incident.status, 80)}`,
    "",
    "Ship State",
    ...(input.ship ? [
      `- status/mode: ${input.ship.status} / ${input.ship.dryRun ? "dry-run" : "execute"}`,
      `- main_updated/restart_attempted: ${input.ship.mainUpdated ? "yes" : "no"} / ${input.ship.restartAttempted ? "yes" : "no"}`,
      ...(input.ship.restart ? [
        `- restart: ${input.ship.restart.ok ? "ok" : input.ship.restart.reason ?? "failed"} tasks=${input.ship.restart.runningTasks.length} chats=${input.ship.restart.runningChats.length}`,
      ] : []),
      `- message: ${safeText(input.ship.message, 220)}`,
    ] : ["- not requested"]),
    "",
    "Repair Branch",
    ...(input.repairRun ? [
      `- repair_run/status: ${input.repairRun.id} / ${input.repairRun.status}`,
      `- branch: ${safeText(input.repairRun.branch, 140)}`,
      `- commit/base: ${safeText(input.repairRun.commit_sha, 90)} / ${safeText(input.repairRun.base_sha, 90)}`,
      `- workspace/completed_at: ${safeText(input.repairRun.workspace_path, 140)} / ${input.repairRun.completed_at ?? "-"}`,
    ] : ["- (none)"]),
    "",
    "Risks",
    ...riskLines({ repairRun: input.repairRun, verification, blockers: allBlockers, errors, changedFiles: allChangedFiles, ship: input.ship }),
    "",
    "Rollback",
    `- ${rollbackLine(input.repairRun, input.ship)}`,
    "",
    "Operator Commands",
    ...commandLines(input.incident.id),
    "",
    "Diff Summary",
    `- ${safeText(diffSummary, 220)}`,
    "",
    "Changed Paths",
    ...(changedFiles.length ? changedFiles.map((file) => `- ${safeText(file, 120)}`) : ["- not recorded"]),
    ...(omittedChangedFileCount ? [`- (${omittedChangedFileCount} more path(s) omitted)`] : []),
    "",
    "Verification",
    ...verificationReviewLines(verification),
    "",
    "Path Policy / Blockers",
    ...pathPolicyLines({ blockers, dirtyFiles }),
    ...errors.map((item) => `- error: ${safeText(item, 180)}`),
  ];

  return lines.join("\n");
}

export function formatDoctorRepairResult(result: RepairReportResult): string {
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
