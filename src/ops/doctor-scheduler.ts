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

function zhIncidentType(type: string): string {
  const labels: Record<string, string> = {
    task_failed: "任务失败",
    task_interrupted: "任务中断",
    task_running_too_long: "任务运行过久",
    cron_failed: "定时任务失败",
    chat_error: "聊天错误",
    discord_outage: "Discord 连接异常",
    pm2_restart_loop: "PM2 重启异常",
    unknown: "未知事件",
  };
  return labels[type] ?? type;
}

function zhSeverity(severity: string): string {
  const labels: Record<string, string> = {
    info: "信息",
    warning: "警告",
    critical: "严重",
  };
  return labels[severity] ?? severity;
}

function zhCategory(category: string): string {
  const labels: Record<string, string> = {
    user_prompt: "用户输入",
    network: "网络",
    discord: "Discord",
    provider_data: "上游数据",
    provider_auth: "Provider 认证",
    miniclaw_bug: "MiniClaw 代码/运行时",
    third_party: "第三方服务",
    unknown: "未知",
  };
  return labels[category] ?? category;
}

function zhText(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const exact: Record<string, string> = {
    "A scheduled cron job recently failed.": "最近有一个定时任务失败。",
    "A Discord task was interrupted and may need resume or recovery.": "一个 Discord 任务被中断，可能需要 resume 或 recovery。",
    "Auto Doctor created an incident.": "Auto Doctor 创建了一个 incident。",
    "Auto Doctor created similar incidents.": "Auto Doctor 创建了一组相似 incident。",
    "Check VPN/proxy/network and Discord reachability before changing code.": "先检查 VPN/proxy/network 和 Discord 连通性，再考虑改代码。",
    "Doctor did not find a clear failing task, cron error, Discord outage, or PM2 restart loop.": "Doctor 没有发现明确失败的 task、cron error、Discord outage 或 PM2 restart loop。",
    "Refresh or diagnose the provider session/auth path; do not auto-repair credentials.": "刷新或诊断 provider session/auth 路径；不要自动修复凭据。",
    "Repair later.": "稍后执行修复。",
    "Review evidence and decide whether to create a focused repair task.": "先 review 证据，再决定是否创建聚焦修复任务。",
    "The incident needs human review before deciding whether it is repairable.": "这个 incident 需要人工 review 后再判断是否可修复。",
    "The strongest signal points to a MiniClaw code/runtime bug.": "最强信号指向 MiniClaw 代码或运行时 bug。",
    "The strongest signal points to connectivity rather than a code repair.": "最强信号指向连接/上游通道问题，而不是代码修复。",
    "The strongest signal points to missing or empty upstream data.": "最强信号指向上游数据缺失或为空。",
    "The strongest signal points to provider authentication/session health.": "最强信号指向 provider 认证或 session 健康问题。",
    "Use /resume if a provider session exists; inspect restart/drain logs before changing code.": "如果 provider session 仍存在，优先使用 /resume；改代码前先检查 restart/drain 日志。",
    "Verify upstream data availability and cron/provider filters.": "先确认上游数据可用性以及 cron/provider 过滤条件。",
    "Workspace has dirty files; review them before any repair workflow.": "工作区存在未提交修改；执行修复流程前请先 review。",
  };
  const translated = exact[text];
  if (translated) return translated;
  return text
    .replace(/^Task failed: (.+)$/u, "任务失败：$1")
    .replace(/^Task interrupted: (.+)$/u, "任务中断：$1")
    .replace(/^Task still running: (.+)$/u, "任务仍在运行：$1")
    .replace(/^Cron failed: (.+)$/u, "定时任务失败：$1")
    .replace(/^Recent cron failure: (.+)$/u, "最近定时任务失败：$1")
    .replace(/^Cron job not found: (.+)$/u, "未找到定时任务：$1")
    .replace(/^Connectivity degraded: (.+)$/u, "连接状态下降：$1")
    .replace(/^PM2 app has unstable restarts: (.+)$/u, "PM2 app 存在不稳定重启：$1");
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
  const nextAction = zhText(diagnosis.recommendedAction ?? report.diagnosis.recommendedAction) ?? "";
  const lines = [
    `🩺 MiniClaw Doctor：${zhText(incident.title) ?? incident.title}`,
    "",
    `Incident：\`${incident.id.slice(0, 8)}\``,
    `类型：${zhIncidentType(incident.type)}（\`${incident.type}\`）`,
    `级别：${zhSeverity(incident.severity)}（\`${incident.severity}\`）`,
    `对象：\`${incident.subject_type ?? "unknown"}:${incident.subject_id ?? "-"}\``,
    `允许自动修复：${diagnosis.repairAllowed ? "是" : "否"}`,
    "",
    zhText(incident.summary) ?? "Auto Doctor 创建了一个 incident。",
    "",
    "证据：",
    ...evidenceLines.map((line) => `- ${line}`),
    "",
    "下一步：",
    nextAction,
  ];

  if (!candidate.notify) {
    lines.push("", "通知原因：仅内部扫描。");
  }
  return lines.join("\n").slice(0, 1900);
}

function listShortIds(values: string[], limit: number): string {
  const shortIds = values.slice(0, limit).map((id) => `\`${id.slice(0, 8)}\``);
  const suffix = values.length > limit ? `（另有 ${values.length - limit} 个）` : "";
  return `${shortIds.join(", ")}${suffix}`;
}

function groupSubjectLine(group: DoctorNotificationGroup): string {
  const primary = group.items[0];
  const subjectType = primary.incident.subject_type ?? "subject";
  const ids = group.items
    .map((item) => item.incident.subject_id)
    .filter((id): id is string => Boolean(id));
  const label = subjectType === "task"
    ? "任务"
    : subjectType === "cron"
      ? "定时任务"
      : `${subjectType} 对象`;
  return `${label}：${ids.length ? listShortIds(ids, 8) : "（未知）"}`;
}

function groupedTitle(group: DoctorNotificationGroup): string {
  const primary = group.items[0].incident;
  if (primary.type === "task_failed") return `${group.items.length} 个相似任务失败`;
  if (primary.type === "task_interrupted") return `${group.items.length} 个相似任务中断`;
  if (primary.type === "task_running_too_long") return `${group.items.length} 个相似长时间运行任务`;
  if (primary.type === "cron_failed") return `${group.items.length} 个相似定时任务失败`;
  return `${group.items.length} 个相似 ${zhIncidentType(primary.type)} incident`;
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
  const nextAction = zhText(diagnosis.recommendedAction ?? report.diagnosis.recommendedAction) ?? "";
  const lines = [
    `🩺 MiniClaw Doctor：${groupedTitle(group)}`,
    "",
    `类型：${zhIncidentType(primary.incident.type)}（\`${primary.incident.type}\`）`,
    `级别：${zhSeverity(primary.incident.severity)}（\`${primary.incident.severity}\`）`,
    `类别：${zhCategory(category)}（\`${category}\`）`,
    `允许自动修复：${repairAllowed ? "是" : "否"}`,
    `Incidents：${listShortIds(group.items.map((item) => item.incident.id), 8)}`,
    groupSubjectLine(group),
    "",
    zhText(primary.incident.summary) ?? "Auto Doctor 创建了一组相似 incident。",
    "",
    "重复错误：",
    repeatedError,
    "",
    "证据：",
    ...groupedEvidenceSummary(group, report).map((line) => `- ${line}`),
    "",
    "下一步：",
    nextAction,
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
    `- 类型=${primary.incident.type}/${zhSeverity(primary.incident.severity)}`,
    `类别=${groupCategory(group, report)}`,
    `x${group.items.length}`,
    `route=${groupRoute(group)}`,
    `${subjectLabel}=${ids.length ? listShortIds(ids, 4) : "(unknown)"}`,
    repeatedError ? `错误=${repeatedError}` : "",
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
    .map(([category, count]) => `${zhCategory(category)}(${category})=${count}`)
    .join(", ");
  const lines = [
    `🩺 MiniClaw Doctor：发现 ${incidents.length} 个 incident，分布在 ${groups.length} 个分组中`,
    "",
    `生成时间：\`${report.evidence.generatedAt}\``,
    `类别：${categorySummary || "未知"}`,
    `Incidents：${listShortIds(incidents.map((item) => item.incident.id), 10)}`,
    "",
    "分组：",
    ...largestGroups.slice(0, 8).map((group) => formatDigestGroupLine(group, report)),
  ];

  if (largestGroups.length > 8) {
    lines.push(`- （另有 ${largestGroups.length - 8} 个分组）`);
  }

  lines.push(
    "",
    "下一步：",
    zhText(report.diagnosis.recommendedAction) ?? ""
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
    `MiniClaw Doctor Repair：${result.ok ? "可 review" : "已阻塞"}`,
    "",
    `Incident：\`${result.incident.id.slice(0, 8)}\` ${zhText(result.incident.title) ?? result.incident.title}`,
    `模式：${result.dryRun ? "dry-run" : "execute"}`,
    `工作区：\`${result.workspacePath}\``,
    `分支：\`${result.branch}\``,
    ...(result.commitSha ? [`Commit：\`${result.commitSha.slice(0, 12)}\``] : []),
    ...(result.pushed ? [`已 push：\`${result.pushTarget ?? "yes"}\``] : []),
    ...(result.pushError ? [`Push 错误：${result.pushError.slice(0, 240)}`] : []),
    `消息：${zhText(result.message) ?? result.message}`,
    "",
    "修改文件：",
    ...(result.changedFiles.length ? result.changedFiles.map((file) => `- ${file}`) : ["- （无）"]),
    "",
    "验证：",
    ...(result.verification.length
      ? result.verification.map((item) => `- ${item.ok ? "通过" : "失败"}：${item.command}`)
      : ["- （未运行）"]),
  ];
  if (result.policy.blockers.length) {
    lines.push("", "策略阻塞：", ...result.policy.blockers.map((item) => `- ${item}`));
  }
  if (result.pushed) {
    lines.push(
      "",
      "Ship 审批：",
      `- 预览：\`pnpm run doctor:ship -- --incident ${result.incident.id}\``,
      `- Ship 到 main：\`pnpm run doctor:ship -- --incident ${result.incident.id} --execute --approve-main\``,
      `- Ship 并安全重启：\`pnpm run doctor:ship -- --incident ${result.incident.id} --execute --approve-main --restart\``
    );
  }
  if (result.agent?.response) {
    lines.push("", "Agent 报告：", result.agent.response.slice(0, 600));
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
