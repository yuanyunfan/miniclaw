import type { Client } from "discord.js";
import type { IncidentRow } from "../../store/incidents.js";
import type { DoctorReport } from "../doctor.js";
import { resolveDoctorSummaryChannel } from "../doctor-discord.js";
import type { DoctorIncidentCandidate } from "../doctor-incidents.js";
import type { DoctorRepairResult } from "../doctor-repair.js";
import {
  arrayValue,
  candidateDiagnosis,
  notificationProblemText,
  parseDiagnosisJson,
  recordValue,
  sourceRoute,
  stringValue,
  type DoctorNotificationGroup,
} from "./grouping.js";

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

export function formatIncidentNotification(incident: IncidentRow, candidate: DoctorIncidentCandidate, report: DoctorReport): string {
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

export function formatDoctorNotificationGroup(group: DoctorNotificationGroup, report: DoctorReport): string {
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

export function formatDoctorNotificationGroups(groups: DoctorNotificationGroup[], report: DoctorReport): string {
  if (groups.length === 1) return formatDoctorNotificationGroup(groups[0], report);
  return formatDoctorNotificationDigest(groups, report);
}

export async function sendDoctorNotification(
  client: Client,
  groups: DoctorNotificationGroup[],
  report: DoctorReport
): Promise<void> {
  const channel = await resolveDoctorSummaryChannel(client);
  if (!channel) return;
  await channel.send(formatDoctorNotificationGroups(groups, report));
}

export function formatRepairNotification(result: DoctorRepairResult): string {
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

export async function sendDoctorRepairNotification(client: Client, result: DoctorRepairResult): Promise<void> {
  const channel = await resolveDoctorSummaryChannel(client);
  if (!channel) return;
  await channel.send(formatRepairNotification(result));
}
