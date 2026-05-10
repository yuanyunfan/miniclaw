import type { IncidentEventRow, IncidentRow, RepairRunRow } from "../store/incidents.js";

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

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function truncate(value: string, max = 180): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= max) return singleLine;
  return `${singleLine.slice(0, Math.max(0, max - 1))}...`;
}

function field(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null || value === "") return undefined;
  return truncate(stringifyValue(value));
}

function formatCommandLines(id: string, status: string): string[] {
  const lines = [
    `- View: /incident view id:${id.slice(0, 8)}`,
    `- Resolve: /incident resolve id:${id.slice(0, 8)}`,
    `- Ignore: /incident ignore id:${id.slice(0, 8)}`,
  ];
  if (["open", "diagnosed", "repair_blocked"].includes(status)) {
    lines.push(`- Retry repair: /incident retry-repair id:${id.slice(0, 8)}`);
  }
  if (["repair_ready", "shipped"].includes(status)) {
    lines.push(`- Ship preview: /incident ship-preview id:${id.slice(0, 8)}`);
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
  const diagnosis = parseJsonObject(incident.diagnosis_json);
  const latestRepair = repairRuns[0];

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
    "Latest Repair",
    ...(latestRepair ? [
      `- id/status: ${latestRepair.id} / ${latestRepair.status}`,
      `- branch: ${latestRepair.branch ?? "-"}`,
      `- commit: ${latestRepair.commit_sha ?? "-"}`,
      `- workspace: ${latestRepair.workspace_path ?? "-"}`,
      `- completed_at: ${latestRepair.completed_at ?? "-"}`,
    ] : ["- (none)"]),
    "",
    "Recent Events",
    ...(events.length
      ? events.map((event) => `- ${event.created_at} ${event.event_type} ${truncate(event.payload_json ?? "", 120)}`)
      : ["- (none)"]),
    "",
    "Operator Commands",
    ...formatCommandLines(incident.id, incident.status),
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
