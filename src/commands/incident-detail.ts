import type { IncidentEventRow, IncidentRow, RepairRunRow } from "../store/incidents.js";
import { formatDiagnosticValue, redactDiagnosticText } from "../privacy/diagnostic-redaction.js";

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

function truncate(value: string, max = 180): string {
  return redactDiagnosticText(value, { maxChars: max });
}

function field(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null || value === "") return undefined;
  return formatDiagnosticValue(value, { maxChars: 180 });
}

function arrayField(obj: Record<string, unknown>, key: string): unknown[] {
  const value = obj[key];
  return Array.isArray(value) ? value : [];
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

function formatCommandLines(incident: IncidentRow): string[] {
  const id = incident.id;
  const status = incident.status;
  const lines = [
    `- View: /incident view id:${id.slice(0, 8)}`,
    `- Resolve: /incident resolve id:${id.slice(0, 8)}`,
    `- Ignore: /incident ignore id:${id.slice(0, 8)}`,
  ];
  if (incident.subject_type === "task" && incident.subject_id) {
    lines.push(`- Task trace: /task-log id:${incident.subject_id.slice(0, 8)}`);
  }
  if (["open", "diagnosed", "repair_blocked"].includes(status)) {
    lines.push(`- Retry repair: /incident retry-repair id:${id.slice(0, 8)}`);
  }
  if (["repair_ready", "shipped"].includes(status)) {
    lines.push(`- Ship preview: /incident ship-preview id:${id.slice(0, 8)}`);
  }
  if (status === "repair_ready") {
    lines.push(`- Approve ship: /incident approve-ship id:${id.slice(0, 8)} restart:false`);
    lines.push(`- Approve ship + restart: /incident approve-ship id:${id.slice(0, 8)} restart:true`);
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
}): string {
  const { incident, events, repairRuns } = params;
  const source = parseJsonObject(incident.source_json);
  const evidence = parseJsonObject(incident.evidence_json);
  const diagnosis = parseJsonObject(incident.diagnosis_json);
  const latestRepair = repairRuns[0];
  const traceLines = arrayField(evidence, "trace").map(traceLine).filter((line): line is string => Boolean(line)).slice(0, 5);

  const lines = [
    `MiniClaw Incident: ${incident.id}`,
    "",
    "Status",
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
    `- channel_id: ${field(source, "channel_id") ?? "-"}`,
    `- message_url: ${field(source, "message_url") ?? "-"}`,
    `- task_id: ${field(source, "task_id") ?? "-"}`,
    `- cron_name: ${field(source, "cron_name") ?? "-"}`,
    "",
    "Task Trace",
    ...(traceLines.length ? traceLines : ["- (none)"]),
    "",
    "Latest Repair",
    ...(latestRepair ? [
      `- id/status: ${latestRepair.id} / ${latestRepair.status}`,
      `- branch: ${formatDiagnosticValue(latestRepair.branch, { maxChars: 180 })}`,
      `- commit: ${formatDiagnosticValue(latestRepair.commit_sha, { maxChars: 180 })}`,
      `- workspace: ${formatDiagnosticValue(latestRepair.workspace_path, { maxChars: 180 })}`,
      `- completed_at: ${latestRepair.completed_at ?? "-"}`,
    ] : ["- (none)"]),
    "",
    "Recent Events",
    ...(events.length
      ? events.map((event) => `- ${event.created_at} ${event.event_type} ${eventPayloadText(event.payload_json)}`)
      : ["- (none)"]),
    "",
    "Operator Commands",
    ...formatCommandLines(incident),
  ];

  return lines.join("\n").slice(0, 1900);
}

export function formatIncidentResolution(status: "resolved" | "ignored", incident: IncidentRow, reason?: string): string {
  return [
    `✅ Incident ${incident.id.slice(0, 8)} 已标记为 ${status}`,
    `Title: ${incident.title}`,
    ...(reason ? [`Reason: ${reason}`] : []),
  ].join("\n");
}
