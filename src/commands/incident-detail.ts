import type { IncidentEventRow, IncidentRow, RepairRunRow } from "../store/incidents.js";
import type { CronRunRow } from "../store/cron-runs.js";
import { formatDiagnosticValue, redactDiagnosticText } from "../privacy/diagnostic-redaction.js";

const DISCORD_CONTENT_LIMIT = 1900;

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

function truncate(value: string, max = 180): string {
  return redactDiagnosticText(value, { maxChars: max });
}

function clipDiscordContent(value: string): string {
  const suffix = "\n... truncated for Discord";
  return value.length > DISCORD_CONTENT_LIMIT
    ? `${value.slice(0, DISCORD_CONTENT_LIMIT - suffix.length)}${suffix}`
    : value;
}

function shortId(value: string | null | undefined): string {
  return value ? value.slice(0, 8) : "-";
}

function field(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null || value === "") return undefined;
  return formatDiagnosticValue(value, { maxChars: 180 });
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function arrayField(obj: Record<string, unknown>, key: string): unknown[] {
  const value = obj[key];
  return Array.isArray(value) ? value : [];
}

function stringArrayField(obj: Record<string, unknown>, key: string): string[] {
  return arrayField(obj, key).filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function traceLine(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const created = formatDiagnosticValue(row.created_at, { maxChars: 80 });
  const task = formatDiagnosticValue(row.task_id, { maxChars: 80 }).slice(0, 8);
  const severity = formatDiagnosticValue(row.severity, { maxChars: 40 });
  const type = formatDiagnosticValue(row.event_type, { maxChars: 80 });
  const message = row.message ? ` ${formatDiagnosticValue(row.message, { maxChars: 120 })}` : "";
  return `- ${created} ${task} ${severity}/${type}${message}`;
}

function eventPayloadText(payloadJson: string | null): string {
  if (!payloadJson) return "-";
  try {
    return formatDiagnosticValue(JSON.parse(payloadJson) as unknown, { maxChars: 240 });
  } catch {
    return redactDiagnosticText(payloadJson, { maxChars: 240 });
  }
}

function latestEvent(events: IncidentEventRow[], eventTypes: readonly string[]): IncidentEventRow | undefined {
  const types = new Set(eventTypes);
  return events.find((event) => types.has(event.event_type));
}

function verificationLines(verification: unknown[]): string[] {
  if (!verification.length) return ["- (not run or not recorded)"];
  return verification.slice(0, 6).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return `- ${formatDiagnosticValue(item, { maxChars: 160 })}`;
    }
    const row = item as Record<string, unknown>;
    const ok = row.ok === true ? "ok" : row.ok === false ? "failed" : "unknown";
    const command = formatDiagnosticValue(row.command, { maxChars: 150 });
    const duration = typeof row.durationMs === "number" ? ` duration=${Math.round(row.durationMs)}ms` : "";
    return `- ${ok}: ${command}${duration}`;
  });
}

function latestRepairLines(repair: RepairRunRow | undefined): string[] {
  if (!repair) return ["- (none)"];

  const report = parseJsonObject(repair.report_json);
  const verification = parseJsonArray(repair.verification_json);
  const changedFiles = stringArrayField(report, "changedFiles").slice(0, 8);
  const blockers = stringArrayField(report, "blockers").slice(0, 8);
  const dirtyFiles = stringArrayField(report, "dirtyFiles").slice(0, 8);
  const errors = [
    stringField(report, "commitError"),
    stringField(report, "pushError"),
  ].filter((item): item is string => Boolean(item));

  return [
    `- id/status: ${repair.id} / ${repair.status}`,
    `- branch: ${formatDiagnosticValue(repair.branch, { maxChars: 120 })} commit: ${formatDiagnosticValue(repair.commit_sha, { maxChars: 80 })} base: ${formatDiagnosticValue(repair.base_sha, { maxChars: 80 })}`,
    `- workspace: ${formatDiagnosticValue(repair.workspace_path, { maxChars: 120 })} completed_at: ${repair.completed_at ?? "-"}`,
    ...(changedFiles.length ? [`- changed_files: ${changedFiles.map((file) => formatDiagnosticValue(file, { maxChars: 80 })).join(", ")}`] : []),
    ...(dirtyFiles.length ? [`- dirty_files: ${dirtyFiles.map((file) => formatDiagnosticValue(file, { maxChars: 80 })).join(", ")}`] : []),
    ...(blockers.length ? [`- blockers: ${blockers.map((item) => formatDiagnosticValue(item, { maxChars: 120 })).join(" | ")}`] : []),
    ...errors.map((item) => `- error: ${formatDiagnosticValue(item, { maxChars: 180 })}`),
    ...(verification.length ? ["- verification:", ...verificationLines(verification)] : []),
  ];
}

function cronRunLines(cronRuns: CronRunRow[]): string[] {
  if (!cronRuns.length) return ["- (none linked)"];
  return cronRuns.slice(0, 3).map((row) => {
    const task = row.task_id ? ` task=${shortId(row.task_id)}` : "";
    const error = row.error_category ? ` error=${formatDiagnosticValue(row.error_category, { maxChars: 60 })}` : "";
    return `- ${row.started_at} ${row.status} attempt=${row.attempt} id=${shortId(row.id)} job=${formatDiagnosticValue(row.job_name, { maxChars: 80 })}${task}${error}`;
  });
}

function shipRestartLines(params: {
  incident: IncidentRow;
  latestRepair?: RepairRunRow;
  events: IncidentEventRow[];
}): string[] {
  const { incident, latestRepair, events } = params;
  const preview = latestEvent(events, ["ship_preview_requested"]);
  const mainUpdated = latestEvent(events, ["repair_main_updated"]);
  const restart = latestEvent(events, ["live_restart_completed", "live_restart_deferred", "live_restart_failed"]);
  const previewPayload = parseJsonObject(preview?.payload_json ?? null);
  const mainPayload = parseJsonObject(mainUpdated?.payload_json ?? null);
  const restartPayload = parseJsonObject(restart?.payload_json ?? null);

  const readiness = latestRepair
    ? latestRepair.status === "repair_pushed"
      ? "repair branch pushed; ship preview/approval is available"
      : latestRepair.status === "repair_ready"
        ? "repair verified locally; branch is not recorded as pushed"
        : `latest repair status=${latestRepair.status}`
    : "no repair run yet";

  return [
    `- readiness: ${readiness}`,
    `- ship_preview: ${preview ? `${preview.created_at} status=${field(previewPayload, "status") ?? "-"}` : "not requested"}; main_update: ${mainUpdated ? `${mainUpdated.created_at} main_sha=${field(mainPayload, "main_sha") ?? "-"}` : incident.status === "shipped" ? "shipped status recorded; event not in recent window" : "not shipped"}; restart: ${restart ? `${restart.created_at} ${restart.event_type} reason=${field(restartPayload, "reason") ?? "-"} app=${field(restartPayload, "app") ?? "-"}` : "not attempted or not in recent window"}`,
  ];
}

function rollbackLines(incident: IncidentRow, latestRepair?: RepairRunRow): string[] {
  if (!latestRepair?.commit_sha) {
    return ["- no repair commit recorded; keep the incident open or ignore after manual review"];
  }
  const commit = latestRepair.commit_sha;
  if (incident.status === "shipped") {
    return [
      `- main revert: git revert ${commit}; git push origin main; then verify and request safe restart`,
    ];
  }
  return [
    `- pre-ship: reject/replace ${latestRepair.branch ?? "-"}; no main revert needed`,
  ];
}

function nextActionLine(params: {
  incident: IncidentRow;
  diagnosis: Record<string, unknown>;
  latestRepair?: RepairRunRow;
  events: IncidentEventRow[];
}): string {
  const { incident, diagnosis, latestRepair, events } = params;
  const restart = latestEvent(events, ["live_restart_deferred", "live_restart_failed", "live_restart_completed"]);
  if (incident.status === "resolved" || incident.status === "ignored") {
    return "No action required unless the symptom recurs.";
  }
  if (incident.status === "shipped" && restart?.event_type === "live_restart_completed") {
    return "Monitor the next Doctor scan, then resolve the incident if the symptom stays clear.";
  }
  if (incident.status === "shipped" && restart && restart.event_type !== "live_restart_completed") {
    return "Clear the restart blocker and use /incident request-restart after checking active work.";
  }
  if (!latestRepair) {
    return field(diagnosis, "recommendedAction") ?? "Review diagnosis, then decide whether to retry repair or resolve manually.";
  }
  if (["blocked", "verification_failed", "commit_failed", "push_failed"].includes(latestRepair.status)) {
    return "Review blockers and verification output, then retry repair or patch manually in a safe worktree.";
  }
  if (latestRepair.status === "repair_ready") {
    return "Review the verified repair branch and push it before ship preview, or rerun repair with auto-push enabled.";
  }
  if (latestRepair.status === "repair_pushed") {
    return "Run ship preview, review changed paths and verification, then approve ship only if the branch is expected.";
  }
  return field(diagnosis, "recommendedAction") ?? "Review the incident and choose the next operator command.";
}

function formatCommandLines(incident: IncidentRow, cronRuns: CronRunRow[], latestRepair?: RepairRunRow): string[] {
  const id = incident.id;
  const status = incident.status;
  const lines = [
    `- Resolve/ignore: /incident resolve id:${id.slice(0, 8)} or /incident ignore id:${id.slice(0, 8)}`,
  ];
  if (incident.subject_type === "task" && incident.subject_id) {
    lines.push(`- Task trace: /task-log id:${incident.subject_id.slice(0, 8)}`);
  }
  if (incident.subject_type === "cron" && cronRuns.length) {
    lines.push(`- Cron run: /cron-run id:${cronRuns[0]!.id.slice(0, 8)}`);
  }
  if (latestRepair) {
    lines.push(`- Local ship preview: pnpm run doctor:ship -- --incident ${id}`);
  }
  if (["open", "diagnosed", "repair_blocked"].includes(status)) {
    lines.push(`- Retry repair: /incident retry-repair id:${id.slice(0, 8)}`);
  }
  if (["repair_ready", "shipped"].includes(status)) {
    lines.push(`- Ship preview: /incident ship-preview id:${id.slice(0, 8)}`);
  }
  if (status === "repair_ready") {
    lines.push(`- Approve ship: /incident approve-ship id:${id.slice(0, 8)} restart:false (or true)`);
  }
  if (status === "shipped") {
    lines.push(`- Request safe restart: /incident request-restart id:${id.slice(0, 8)}`);
  }
  return lines;
}

export function formatIncidentDetail(params: {
  incident: IncidentRow;
  events: IncidentEventRow[];
  repairRuns: RepairRunRow[];
  cronRuns?: CronRunRow[];
}): string {
  const { incident, events, repairRuns, cronRuns = [] } = params;
  const source = parseJsonObject(incident.source_json);
  const evidence = parseJsonObject(incident.evidence_json);
  const diagnosis = parseJsonObject(incident.diagnosis_json);
  const latestRepair = repairRuns[0];
  const traceLines = arrayField(evidence, "trace").map(traceLine).filter((line): line is string => Boolean(line)).slice(0, 5);
  const showCronRuns = incident.subject_type === "cron" || cronRuns.length > 0;

  const lines = [
    `MiniClaw Incident: ${incident.id}`,
    "",
    "Core",
    `- title: ${incident.title}`,
    `- type: ${incident.type}`,
    `- severity/status: ${incident.severity}/${incident.status}`,
    `- subject: ${incident.subject_type ?? "unknown"}:${incident.subject_id ?? "-"}`,
    `- created/updated: ${incident.created_at} / ${incident.updated_at}`,
    ...(incident.resolved_at ? [`- resolved_at: ${incident.resolved_at}`] : []),
    ...(incident.summary ? ["", "Summary", `- ${truncate(incident.summary, 400)}`] : []),
    "",
    "Diagnosis",
    `- category: ${field(diagnosis, "category") ?? "-"}`,
    `- repairAllowed: ${field(diagnosis, "repairAllowed") ?? "-"}`,
    `- recommendedAction: ${field(diagnosis, "recommendedAction") ?? "-"}`,
    "",
    "Source",
    `- route/provider: ${field(source, "route") ?? "-"} / ${field(source, "provider") ?? field(source, "providerName") ?? field(source, "provider_name") ?? "-"}`,
    `- task_id: ${field(source, "task_id") ?? "-"} cron_name: ${field(source, "cron_name") ?? "-"} cron_run_id: ${field(source, "cron_run_id") ?? field(source, "failure_run_id") ?? "-"}`,
    `- channel_id: ${field(source, "channel_id") ?? "-"} message_url: ${field(source, "message_url") ?? "-"}`,
    "",
    "Task Trace",
    ...(traceLines.length ? traceLines : ["- (none)"]),
    ...(showCronRuns ? [
      "",
      "Cron Runs",
      ...cronRunLines(cronRuns),
    ] : []),
    "",
    "Latest Repair",
    ...latestRepairLines(latestRepair),
    "",
    "Ship / Restart",
    ...shipRestartLines({ incident, latestRepair, events }),
    "",
    "Rollback",
    ...rollbackLines(incident, latestRepair),
    "",
    "Next Action",
    `- ${nextActionLine({ incident, diagnosis, latestRepair, events })}`,
    "",
    "Operator Commands",
    ...formatCommandLines(incident, cronRuns, latestRepair),
    "",
    "Recent Events",
    ...(events.length
      ? events.map((event) => `- ${event.created_at} ${event.event_type} ${eventPayloadText(event.payload_json)}`)
      : ["- (none)"]),
  ];

  return clipDiscordContent(lines.join("\n"));
}

export function formatIncidentResolution(status: "resolved" | "ignored", incident: IncidentRow, reason?: string): string {
  return [
    `✅ Incident ${incident.id.slice(0, 8)} 已标记为 ${status}`,
    `Title: ${incident.title}`,
    ...(reason ? [`Reason: ${reason}`] : []),
  ].join("\n");
}
