import type { IncidentListFilters, IncidentRow } from "../store/incidents.js";
import { OPEN_INCIDENT_STATUSES } from "../store/incidents.js";
import { redactDiagnosticText } from "../privacy/diagnostic-redaction.js";

export interface IncidentListReplyParams {
  incidents: IncidentRow[];
  total: number;
  filters: IncidentListFilters;
  repairStatuses?: ReadonlyMap<string, string | null | undefined>;
  now?: Date;
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

function textField(obj: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function sourceRoute(incident: IncidentRow): string | undefined {
  const source = parseJsonObject(incident.source_json);
  return textField(source, ["route", "route_type", "source_route_type"]);
}

function sourceProvider(incident: IncidentRow): string | undefined {
  const source = parseJsonObject(incident.source_json);
  return textField(source, ["provider", "providerName", "provider_name"]);
}

function countBy<T>(items: readonly T[], select: (item: T) => string | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = select(item)?.trim() || "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function compactCounts(counts: Record<string, number>, max = 5): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max);
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(", ") : "-";
}

function ageSince(iso: string, now: Date): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function cleanTitle(title: string): string {
  return redactDiagnosticText(title, { maxChars: 96 }).replace(/\s+/g, " ").trim();
}

function subjectText(incident: IncidentRow): string {
  return `${incident.subject_type ?? "unknown"}:${incident.subject_id ?? "-"}`;
}

function filterSummary(filters: IncidentListFilters): string {
  const parts = [
    filters.status
      ? `status=${filters.status}`
      : `status=open-set(${OPEN_INCIDENT_STATUSES.join("|")})`,
  ];
  if (filters.type) parts.push(`type=${filters.type}`);
  if (filters.severity) parts.push(`severity=${filters.severity}`);
  if (filters.category) parts.push(`category=${filters.category}`);
  if (filters.provider) parts.push(`provider=${filters.provider}`);
  if (filters.route) parts.push(`route=${filters.route}`);
  if (filters.repairStatus) parts.push(`repair_status=${filters.repairStatus}`);
  return parts.join(", ");
}

export function normalizeIncidentListLimit(value: number | null | undefined): number {
  return Math.min(Math.max(Math.floor(value ?? 10), 1), 25);
}

export function normalizeIncidentFilterValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function buildIncidentListReply(params: IncidentListReplyParams): string {
  const { incidents, total, filters, repairStatuses } = params;
  const now = params.now ?? new Date();
  const severityCounts = countBy(incidents, (incident) => incident.severity);
  const typeCounts = countBy(incidents, (incident) => incident.type);
  const rows = incidents.map((incident) => {
    const repairStatus = repairStatuses?.get(incident.id) ?? "none";
    const route = sourceRoute(incident);
    const provider = sourceProvider(incident);
    return [
      `- ${incident.id.slice(0, 8)} [${incident.severity}/${incident.status}] ${incident.type} repair=${repairStatus} updated=${ageSince(incident.updated_at, now)}`,
      `  ${cleanTitle(incident.title)}`,
      `  subject=${subjectText(incident)}${route ? ` route=${route}` : ""}${provider ? ` provider=${provider}` : ""}`,
    ].join("\n");
  });

  const firstIncident = incidents[0];
  const lines = [
    `MiniClaw incidents (${incidents.length}/${total} shown)`,
    `Filters: ${filterSummary(filters)}`,
    "",
    "Groups",
    `- severity: ${compactCounts(severityCounts)}`,
    `- type: ${compactCounts(typeCounts)}`,
    "",
    "Rows",
    ...(rows.length ? rows : ["- (none)"]),
    "",
    "Hints",
    ...(firstIncident ? [`- Detail: /incident view id:${firstIncident.id.slice(0, 8)}`] : []),
    "- Filters: /incidents status:repair_ready type:task_failed severity:warning category:miniclaw_bug repair_status:repair_pushed",
  ];

  return lines.join("\n").slice(0, 1900);
}
