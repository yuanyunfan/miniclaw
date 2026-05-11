import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Client } from "discord.js";
import { config } from "../config.js";
import { createLogger } from "../lib/log.js";
import { isDraining } from "../runtime/shutdown.js";
import {
  appendIncidentEvent,
  countRepairRunsByStatus,
  countRepairRunsSince,
  createOrUpdateIncident,
  type CreateOrUpdateIncidentResult,
  type IncidentRow,
} from "../store/incidents.js";
import { runDoctor, type DoctorReport } from "./doctor.js";
import { doctorSummaryChannelEventTarget, resolveDoctorSummaryChannel } from "./doctor-discord.js";
import { deriveDoctorIncidentCandidates, type DoctorIncidentCandidate } from "./doctor-incidents.js";
import { runDoctorRepair, type DoctorRepairResult } from "./doctor-repair.js";

const log = createLogger("doctor-scheduler");
const DEFAULT_LOG_DIR = "~/.miniclaw/logs";
const DOCTOR_LOG_FILES = ["miniclaw-error.log", "miniclaw-out.log"] as const;

export interface DoctorScanResult {
  skipped?: "disabled" | "draining" | "already_running" | "no_new_logs";
  report?: DoctorReport;
  created: IncidentRow[];
  updated: IncidentRow[];
  notified: IncidentRow[];
  repaired: DoctorRepairResult[];
  repairSkipped: DoctorRepairSkip[];
}

export type DoctorRepairSkipReason =
  | "status_not_repairable"
  | "not_repair_allowed"
  | "max_parallel_repairs"
  | "max_repairs_per_day"
  | "repair_error";

export interface DoctorRepairSkip {
  incident: IncidentRow;
  reason: DoctorRepairSkipReason;
  message?: string;
}

export interface DoctorNotificationItem {
  incident: IncidentRow;
  candidate: DoctorIncidentCandidate;
}

export interface DoctorNotificationGroup {
  key: string;
  items: DoctorNotificationItem[];
}

export interface DoctorSchedulerHandle {
  runOnce(reason?: string): Promise<DoctorScanResult>;
  stop(): void;
}

type DoctorSchedulerDeps = {
  runDoctorFn?: typeof runDoctor;
  runRepairFn?: typeof runDoctorRepair;
  createOrUpdateIncidentFn?: typeof createOrUpdateIncident;
  appendIncidentEventFn?: typeof appendIncidentEvent;
  countRepairRunsSinceFn?: typeof countRepairRunsSince;
  countRepairRunsByStatusFn?: typeof countRepairRunsByStatus;
  sendNotificationFn?: (client: Client, groups: DoctorNotificationGroup[], report: DoctorReport) => Promise<void>;
  sendRepairNotificationFn?: (client: Client, result: DoctorRepairResult) => Promise<void>;
  drainingFn?: () => boolean;
  nowFn?: () => Date;
  logFingerprintFn?: () => string | null;
};

function resolveHome(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

function envOptional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function logDir(): string {
  return resolveHome(envOptional("MINICLAW_LOG_DIR") ?? DEFAULT_LOG_DIR);
}

function logFingerprint(): string | null {
  try {
    const dir = logDir();
    return DOCTOR_LOG_FILES.map((file) => {
      const path = join(dir, file);
      if (!existsSync(path)) return `${file}:missing`;
      const stat = statSync(path);
      return `${file}:${stat.size}:${stat.mtimeMs}`;
    }).join("|");
  } catch {
    return null;
  }
}

function shouldNotify(result: CreateOrUpdateIncidentResult): boolean {
  return result.created || result.severityEscalated;
}

function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseDiagnosisJson(value: string | null): {
  category?: string;
  repairAllowed?: boolean;
  recommendedAction?: string;
} {
  const parsed = parseJsonRecord(value);
  return {
    category: stringValue(parsed.category),
    repairAllowed: typeof parsed.repairAllowed === "boolean" ? parsed.repairAllowed : undefined,
    recommendedAction: stringValue(parsed.recommendedAction),
  };
}

function startOfUtcDayIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function canAttemptRepair(incident: IncidentRow): DoctorRepairSkipReason | undefined {
  if (!["open", "diagnosed"].includes(incident.status)) return "status_not_repairable";
  const diagnosis = parseDiagnosisJson(incident.diagnosis_json);
  if (diagnosis.repairAllowed !== true) return "not_repair_allowed";
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function candidateDiagnosis(candidate: DoctorIncidentCandidate): {
  category?: string;
  repairAllowed?: boolean;
  recommendedAction?: string;
} {
  const diagnosis = recordValue(candidate.diagnosis);
  return {
    category: stringValue(diagnosis.category),
    repairAllowed: typeof diagnosis.repairAllowed === "boolean" ? diagnosis.repairAllowed : undefined,
    recommendedAction: stringValue(diagnosis.recommendedAction),
  };
}

function sourceRoute(candidate: DoctorIncidentCandidate): string | undefined {
  const source = recordValue(candidate.source);
  const route = stringValue(source.route);
  if (route) return route;
  const evidence = recordValue(candidate.evidence);
  const task = recordValue(evidence.task);
  return stringValue(task.source_route_type);
}

function taskResultSummary(candidate: DoctorIncidentCandidate): string | undefined {
  const evidence = recordValue(candidate.evidence);
  const task = recordValue(evidence.task);
  return stringValue(task.result_summary);
}

function traceErrorMessage(candidate: DoctorIncidentCandidate): string | undefined {
  const evidence = recordValue(candidate.evidence);
  for (const item of arrayValue(evidence.trace)) {
    const event = recordValue(item);
    const severity = stringValue(event.severity);
    if (severity && !["warning", "error"].includes(severity)) continue;
    const message = stringValue(event.message);
    if (message) return message;
    const eventType = stringValue(event.event_type);
    if (eventType) return eventType;
  }
  return undefined;
}

function cronError(candidate: DoctorIncidentCandidate): string | undefined {
  const evidence = recordValue(candidate.evidence);
  const cron = recordValue(evidence.cron);
  return stringValue(cron.last_error);
}

function notificationProblemText(candidate: DoctorIncidentCandidate, report: DoctorReport): string {
  return taskResultSummary(candidate)
    ?? traceErrorMessage(candidate)
    ?? cronError(candidate)
    ?? candidate.summary
    ?? report.diagnosis.summary;
}

function normalizeNotificationSignature(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b[0-9a-f]{8,}\b/gi, "<hex>")
    .replace(/\btask[-_:][a-z0-9._-]+\b/gi, "task:<id>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function notificationGroupKey(item: DoctorNotificationItem, report: DoctorReport): string {
  const diagnosis = candidateDiagnosis(item.candidate);
  const category = diagnosis.category ?? parseDiagnosisJson(item.incident.diagnosis_json).category ?? report.diagnosis.category;
  const repairAllowed = diagnosis.repairAllowed ?? parseDiagnosisJson(item.incident.diagnosis_json).repairAllowed ?? false;
  const route = sourceRoute(item.candidate) ?? item.incident.subject_type ?? "unknown";
  const signature = normalizeNotificationSignature(notificationProblemText(item.candidate, report));
  return [
    item.incident.type,
    item.incident.severity,
    item.incident.subject_type ?? "unknown",
    route,
    category,
    repairAllowed ? "repairable" : "blocked",
    signature,
  ].join("|");
}

function groupDoctorNotifications(items: DoctorNotificationItem[], report: DoctorReport): DoctorNotificationGroup[] {
  const groups = new Map<string, DoctorNotificationGroup>();
  for (const item of items) {
    const key = notificationGroupKey(item, report);
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
    } else {
      groups.set(key, { key, items: [item] });
    }
  }
  return [...groups.values()];
}

function candidateEvidenceSummary(candidate: DoctorIncidentCandidate, report: DoctorReport): string[] {
  const evidence = recordValue(candidate.evidence);
  const task = recordValue(evidence.task);
  const lines: string[] = [];

  const taskId = stringValue(task.id);
  if (taskId) {
    lines.push(`task=${taskId.slice(0, 8)} status=${stringValue(task.status) ?? "unknown"}`);
  }
  const taskResult = stringValue(task.result_summary);
  if (taskResult) {
    lines.push(`task_result=${taskResult.slice(0, 180)}`);
  }
  const route = sourceRoute(candidate);
  if (route) {
    lines.push(`route=${route}`);
  }

  const traceErrors = arrayValue(evidence.trace)
    .map(recordValue)
    .filter((event) => ["warning", "error"].includes(stringValue(event.severity) ?? ""))
    .slice(0, 3)
    .map((event) => {
      const eventTaskId = stringValue(event.task_id)?.slice(0, 8) ?? taskId?.slice(0, 8) ?? "unknown";
      const eventType = stringValue(event.event_type) ?? "event";
      const message = stringValue(event.message);
      return `${eventTaskId}:${eventType}${message ? `=${message.slice(0, 120)}` : ""}`;
    });
  if (traceErrors.length) {
    lines.push(`trace_errors=${traceErrors.join(" | ")}`);
  }

  const cron = recordValue(evidence.cron);
  const cronName = stringValue(cron.name);
  if (cronName) {
    lines.push(`cron=${cronName} status=${stringValue(cron.last_status) ?? "unknown"}`);
  }
  const cronLastError = stringValue(cron.last_error);
  if (cronLastError) {
    lines.push(`cron_error=${cronLastError.slice(0, 180)}`);
  }

  for (const line of report.diagnosis.evidenceSummary) {
    if (lines.includes(line)) continue;
    if (/^(task=|task_result=|trace_errors=|trace=|route=|cron=|cron_error=)/.test(line)) continue;
    lines.push(line);
  }

  return lines.slice(0, 6);
}

function formatIncidentNotification(incident: IncidentRow, candidate: DoctorIncidentCandidate, report: DoctorReport): string {
  const diagnosis = parseDiagnosisJson(incident.diagnosis_json);
  const evidenceLines = candidateEvidenceSummary(candidate, report);
  const lines = [
    `🩺 MiniClaw Doctor: ${incident.title}`,
    "",
    `Incident: \`${incident.id.slice(0, 8)}\``,
    `Type: \`${incident.type}\``,
    `Severity: \`${incident.severity}\``,
    `Subject: \`${incident.subject_type ?? "unknown"}:${incident.subject_id ?? "-"}\``,
    `Repair allowed: ${diagnosis.repairAllowed ? "yes" : "no"}`,
    "",
    incident.summary ?? "Auto Doctor created an incident.",
    "",
    "Evidence:",
    ...evidenceLines.map((line) => `- ${line}`),
    "",
    "Next action:",
    diagnosis.recommendedAction ?? report.diagnosis.recommendedAction,
  ];

  if (!candidate.notify) {
    lines.push("", "Notification reason: internal scan only.");
  }
  return lines.join("\n").slice(0, 1900);
}

function listShortIds(values: string[], limit: number): string {
  const shortIds = values.slice(0, limit).map((id) => `\`${id.slice(0, 8)}\``);
  const suffix = values.length > limit ? ` (+${values.length - limit} more)` : "";
  return `${shortIds.join(", ")}${suffix}`;
}

function groupSubjectLine(group: DoctorNotificationGroup): string {
  const primary = group.items[0];
  const subjectType = primary.incident.subject_type ?? "subject";
  const ids = group.items
    .map((item) => item.incident.subject_id)
    .filter((id): id is string => Boolean(id));
  const label = subjectType === "task"
    ? "Tasks"
    : subjectType === "cron"
      ? "Cron jobs"
      : `${subjectType[0]?.toUpperCase() ?? "S"}${subjectType.slice(1)}s`;
  return `${label}: ${ids.length ? listShortIds(ids, 8) : "(unknown)"}`;
}

function groupedTitle(group: DoctorNotificationGroup): string {
  const primary = group.items[0].incident;
  if (primary.type === "task_failed") return `${group.items.length} similar task failures`;
  if (primary.type === "task_interrupted") return `${group.items.length} similar interrupted tasks`;
  if (primary.type === "task_running_too_long") return `${group.items.length} similar long-running tasks`;
  if (primary.type === "cron_failed") return `${group.items.length} similar cron failures`;
  return `${group.items.length} similar ${primary.type} incidents`;
}

function groupedEvidenceSummary(group: DoctorNotificationGroup, report: DoctorReport): string[] {
  const primary = group.items[0];
  const route = sourceRoute(primary.candidate);
  const lines = [
    `group_size=${group.items.length}`,
    ...(route ? [`route=${route}`] : []),
  ];

  for (const line of candidateEvidenceSummary(primary.candidate, report)) {
    if (lines.includes(line)) continue;
    if (/^(task=|task_result=|trace_errors=|trace=|route=)/.test(line)) continue;
    lines.push(line);
  }

  return lines.slice(0, 6);
}

function formatGroupedIncidentNotification(group: DoctorNotificationGroup, report: DoctorReport): string {
  const primary = group.items[0];
  const diagnosis = parseDiagnosisJson(primary.incident.diagnosis_json);
  const candidateDiagnosisJson = candidateDiagnosis(primary.candidate);
  const category = candidateDiagnosisJson.category ?? diagnosis.category ?? report.diagnosis.category;
  const repairAllowed = candidateDiagnosisJson.repairAllowed ?? diagnosis.repairAllowed ?? false;
  const repeatedError = notificationProblemText(primary.candidate, report).slice(0, 320);
  const lines = [
    `🩺 MiniClaw Doctor: ${groupedTitle(group)}`,
    "",
    `Type: \`${primary.incident.type}\``,
    `Severity: \`${primary.incident.severity}\``,
    `Category: \`${category}\``,
    `Repair allowed: ${repairAllowed ? "yes" : "no"}`,
    `Incidents: ${listShortIds(group.items.map((item) => item.incident.id), 8)}`,
    groupSubjectLine(group),
    "",
    primary.incident.summary ?? "Auto Doctor created similar incidents.",
    "",
    "Repeated error:",
    repeatedError,
    "",
    "Evidence:",
    ...groupedEvidenceSummary(group, report).map((line) => `- ${line}`),
    "",
    "Next action:",
    diagnosis.recommendedAction ?? report.diagnosis.recommendedAction,
  ];
  return lines.join("\n").slice(0, 1900);
}

function formatDoctorNotificationGroup(group: DoctorNotificationGroup, report: DoctorReport): string {
  if (group.items.length === 1) {
    const item = group.items[0];
    return formatIncidentNotification(item.incident, item.candidate, report);
  }
  return formatGroupedIncidentNotification(group, report);
}

function groupCategory(group: DoctorNotificationGroup, report: DoctorReport): string {
  const primary = group.items[0];
  const diagnosis = parseDiagnosisJson(primary.incident.diagnosis_json);
  return candidateDiagnosis(primary.candidate).category ?? diagnosis.category ?? report.diagnosis.category;
}

function groupRoute(group: DoctorNotificationGroup): string {
  return sourceRoute(group.items[0].candidate) ?? group.items[0].incident.subject_type ?? "unknown";
}

function groupSubjectIds(group: DoctorNotificationGroup): string[] {
  return group.items
    .map((item) => item.incident.subject_id)
    .filter((id): id is string => Boolean(id));
}

function formatDigestGroupLine(group: DoctorNotificationGroup, report: DoctorReport): string {
  const primary = group.items[0];
  const ids = groupSubjectIds(group);
  const subjectLabel = primary.incident.subject_type === "task"
    ? "tasks"
    : primary.incident.subject_type === "cron"
      ? "cron"
      : primary.incident.subject_type ?? "subjects";
  const repeatedError = notificationProblemText(primary.candidate, report)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110);
  return [
    `- ${primary.incident.type}/${primary.incident.severity}`,
    `${groupCategory(group, report)}`,
    `x${group.items.length}`,
    `route=${groupRoute(group)}`,
    `${subjectLabel}=${ids.length ? listShortIds(ids, 4) : "(unknown)"}`,
    repeatedError ? `error=${repeatedError}` : "",
  ].filter(Boolean).join(" ");
}

function formatDoctorNotificationDigest(groups: DoctorNotificationGroup[], report: DoctorReport): string {
  const incidents = groups.flatMap((group) => group.items);
  const largestGroups = [...groups].sort((a, b) => b.items.length - a.items.length);
  const categoryCounts = new Map<string, number>();
  for (const group of groups) {
    categoryCounts.set(groupCategory(group, report), (categoryCounts.get(groupCategory(group, report)) ?? 0) + group.items.length);
  }
  const categorySummary = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `${category}=${count}`)
    .join(", ");
  const lines = [
    `🩺 MiniClaw Doctor: ${incidents.length} incidents in ${groups.length} groups`,
    "",
    `Generated: \`${report.evidence.generatedAt}\``,
    `Categories: ${categorySummary || "unknown"}`,
    `Incidents: ${listShortIds(incidents.map((item) => item.incident.id), 10)}`,
    "",
    "Groups:",
    ...largestGroups.slice(0, 8).map((group) => formatDigestGroupLine(group, report)),
  ];

  if (largestGroups.length > 8) {
    lines.push(`- (+${largestGroups.length - 8} more group(s))`);
  }

  lines.push(
    "",
    "Next action:",
    report.diagnosis.recommendedAction
  );
  return lines.join("\n").slice(0, 1900);
}

function formatDoctorNotificationGroups(groups: DoctorNotificationGroup[], report: DoctorReport): string {
  if (groups.length === 1) return formatDoctorNotificationGroup(groups[0], report);
  return formatDoctorNotificationDigest(groups, report);
}

async function sendDoctorNotification(
  client: Client,
  groups: DoctorNotificationGroup[],
  report: DoctorReport
): Promise<void> {
  const channel = await resolveDoctorSummaryChannel(client);
  if (!channel) return;
  await channel.send(formatDoctorNotificationGroups(groups, report));
}

function formatRepairNotification(result: DoctorRepairResult): string {
  const lines = [
    `MiniClaw Doctor Repair: ${result.ok ? "ready" : "blocked"}`,
    "",
    `Incident: \`${result.incident.id.slice(0, 8)}\` ${result.incident.title}`,
    `Mode: ${result.dryRun ? "dry-run" : "execute"}`,
    `Workspace: \`${result.workspacePath}\``,
    `Branch: \`${result.branch}\``,
    ...(result.commitSha ? [`Commit: \`${result.commitSha.slice(0, 12)}\``] : []),
    ...(result.pushed ? [`Pushed: \`${result.pushTarget ?? "yes"}\``] : []),
    ...(result.pushError ? [`Push error: ${result.pushError.slice(0, 240)}`] : []),
    `Message: ${result.message}`,
    "",
    "Changed files:",
    ...(result.changedFiles.length ? result.changedFiles.map((file) => `- ${file}`) : ["- (none)"]),
    "",
    "Verification:",
    ...(result.verification.length
      ? result.verification.map((item) => `- ${item.ok ? "ok" : "failed"}: ${item.command}`)
      : ["- (not run)"]),
  ];
  if (result.policy.blockers.length) {
    lines.push("", "Policy blockers:", ...result.policy.blockers.map((item) => `- ${item}`));
  }
  if (result.pushed) {
    lines.push(
      "",
      "Ship approval:",
      `- Preview: \`pnpm run doctor:ship -- --incident ${result.incident.id}\``,
      `- Ship to main: \`pnpm run doctor:ship -- --incident ${result.incident.id} --execute --approve-main\``,
      `- Ship + safe restart: \`pnpm run doctor:ship -- --incident ${result.incident.id} --execute --approve-main --restart\``
    );
  }
  if (result.agent?.response) {
    lines.push("", "Agent report:", result.agent.response.slice(0, 600));
  }
  return lines.join("\n").slice(0, 1900);
}

async function sendDoctorRepairNotification(client: Client, result: DoctorRepairResult): Promise<void> {
  const channel = await resolveDoctorSummaryChannel(client);
  if (!channel) return;
  await channel.send(formatRepairNotification(result));
}

export function createDoctorScheduler(
  client: Client,
  deps: DoctorSchedulerDeps = {}
): DoctorSchedulerHandle {
  const runDoctorFn = deps.runDoctorFn ?? runDoctor;
  const runRepairFn = deps.runRepairFn ?? runDoctorRepair;
  const createOrUpdateIncidentFn = deps.createOrUpdateIncidentFn ?? createOrUpdateIncident;
  const appendIncidentEventFn = deps.appendIncidentEventFn ?? appendIncidentEvent;
  const countRepairRunsSinceFn = deps.countRepairRunsSinceFn ?? countRepairRunsSince;
  const countRepairRunsByStatusFn = deps.countRepairRunsByStatusFn ?? countRepairRunsByStatus;
  const sendNotificationFn = deps.sendNotificationFn ?? sendDoctorNotification;
  const sendRepairNotificationFn = deps.sendRepairNotificationFn ?? sendDoctorRepairNotification;
  const drainingFn = deps.drainingFn ?? isDraining;
  const nowFn = deps.nowFn ?? (() => new Date());
  const logFingerprintFn = deps.logFingerprintFn ?? logFingerprint;
  let running = false;
  let lastLogFingerprint: string | null = null;

  const skipResult = (skipped: DoctorScanResult["skipped"]): DoctorScanResult => ({
    skipped,
    created: [],
    updated: [],
    notified: [],
    repaired: [],
    repairSkipped: [],
  });

  const maybeRunRepair = async (incident: IncidentRow): Promise<DoctorRepairResult | DoctorRepairSkip | null> => {
    if (!config.doctor.autoRepairEnabled) return null;
    const policySkip = canAttemptRepair(incident);
    if (policySkip) return { incident, reason: policySkip };

    const activeRepairs = countRepairRunsByStatusFn(["repairing"]);
    if (activeRepairs >= config.doctor.maxParallelRepairs) {
      return { incident, reason: "max_parallel_repairs", message: `active=${activeRepairs}` };
    }

    const repairsToday = countRepairRunsSinceFn(startOfUtcDayIso(nowFn()));
    if (repairsToday >= config.doctor.maxRepairsPerDay) {
      return { incident, reason: "max_repairs_per_day", message: `today=${repairsToday}` };
    }

    try {
      const repairResult = await runRepairFn({
        incidentId: incident.id,
        dryRun: false,
        execute: true,
        force: false,
        json: false,
      });
      try {
        await sendRepairNotificationFn(client, repairResult);
        appendIncidentEventFn(incident.id, "repair_notified", {
          ...doctorSummaryChannelEventTarget(),
          repair_run_id: repairResult.repairRun?.id,
          ok: repairResult.ok,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`doctor repair notification failed for incident ${incident.id}:`, err);
        appendIncidentEventFn(incident.id, "repair_notify_failed", { message });
      }
      return repairResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`doctor repair failed for incident ${incident.id}:`, err);
      appendIncidentEventFn(incident.id, "repair_error", { message });
      return { incident, reason: "repair_error", message };
    }
  };

  return {
    async runOnce(reason = "manual"): Promise<DoctorScanResult> {
      if (!config.doctor.enabled || !config.doctor.autoDiagnoseEnabled) {
        return skipResult("disabled");
      }
      if (drainingFn()) {
        return skipResult("draining");
      }
      if (running) {
        return skipResult("already_running");
      }
      if (reason === "interval") {
        const currentLogFingerprint = logFingerprintFn();
        if (currentLogFingerprint && currentLogFingerprint === lastLogFingerprint) {
          return skipResult("no_new_logs");
        }
      }

      running = true;
      try {
        const report = await runDoctorFn({
          mode: "recent",
          json: false,
          dbPath: config.dbPath,
          connectivityStatePath: config.connectivity.statePath,
          cwd: process.cwd(),
        });
        const candidates = deriveDoctorIncidentCandidates(report);
        const created: IncidentRow[] = [];
        const updated: IncidentRow[] = [];
        const notified: IncidentRow[] = [];
        const repaired: DoctorRepairResult[] = [];
        const repairSkipped: DoctorRepairSkip[] = [];
        const notificationItems: DoctorNotificationItem[] = [];
        const repairTargets: IncidentRow[] = [];

        for (const candidate of candidates) {
          const result = createOrUpdateIncidentFn(candidate);
          appendIncidentEventFn(result.row.id, "doctor_scan", {
            reason,
            created: result.created,
            severity_escalated: result.severityEscalated,
            generated_at: report.evidence.generatedAt,
          });

          if (result.created) created.push(result.row);
          else updated.push(result.row);

          if (candidate.notify && shouldNotify(result)) {
            notificationItems.push({ incident: result.row, candidate });
          }

          repairTargets.push(result.row);
        }

        const notificationGroups = groupDoctorNotifications(notificationItems, report);
        if (notificationGroups.length > 0) {
          await sendNotificationFn(client, notificationGroups, report);
        }
        for (const group of notificationGroups) {
          for (const item of group.items) {
            appendIncidentEventFn(item.incident.id, "doctor_notified", {
              ...doctorSummaryChannelEventTarget(),
              reason,
              grouped: group.items.length > 1,
              group_size: group.items.length,
              group_count: notificationGroups.length,
            });
            notified.push(item.incident);
          }
        }

        for (const incident of repairTargets) {
          const repairOutcome = await maybeRunRepair(incident);
          if (repairOutcome) {
            if ("reason" in repairOutcome) {
              repairSkipped.push(repairOutcome);
              if (["max_parallel_repairs", "max_repairs_per_day", "repair_error"].includes(repairOutcome.reason)) {
                appendIncidentEventFn(incident.id, "repair_skipped", {
                  reason: repairOutcome.reason,
                  message: repairOutcome.message,
                });
              }
            } else {
              repaired.push(repairOutcome);
            }
          }
        }

        if (candidates.length === 0) {
          log.info("doctor scan found no actionable incidents");
        } else {
          log.info(
            `doctor scan processed ${candidates.length} incident candidate(s): created=${created.length} updated=${updated.length} repaired=${repaired.length}`
          );
        }
        lastLogFingerprint = logFingerprintFn();
        return { report, created, updated, notified, repaired, repairSkipped };
      } catch (err) {
        log.error("doctor scan failed:", err);
        throw err;
      } finally {
        running = false;
      }
    },
    stop(): void {
      // The base scheduler has no resources; startDoctorScheduler wraps this.
    },
  };
}

export function startDoctorScheduler(client: Client): DoctorSchedulerHandle | null {
  if (!config.doctor.enabled) {
    log.info("Auto Doctor disabled by config");
    return null;
  }
  if (!config.doctor.autoDiagnoseEnabled) {
    log.info("Auto Doctor scheduler disabled until doctor.auto_diagnose_enabled=true");
    return null;
  }

  const handle = createDoctorScheduler(client);
  const run = (reason: string) => {
    void handle.runOnce(reason).catch((err) => {
      log.error(`doctor ${reason} scan failed:`, err);
    });
  };
  const timer = setInterval(() => {
    if (isDraining()) return;
    run("interval");
  }, config.doctor.scanIntervalMs);
  timer.unref?.();
  log.info(`Auto Doctor scheduler started: interval=${config.doctor.scanIntervalMs}ms`);
  run("startup");

  const originalStop = handle.stop.bind(handle);
  handle.stop = () => {
    originalStop();
    clearInterval(timer);
  };
  return handle;
}

export const __testables = {
  formatIncidentNotification,
  formatDoctorNotificationGroup,
  formatDoctorNotificationGroups,
  groupDoctorNotifications,
  formatRepairNotification,
  startOfUtcDayIso,
};
