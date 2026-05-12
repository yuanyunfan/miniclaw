import type { IncidentRow } from "../../store/incidents.js";
import type { DoctorReport } from "../doctor.js";
import type { DoctorIncidentCandidate } from "../doctor-incidents.js";

export interface DoctorNotificationItem {
  incident: IncidentRow;
  candidate: DoctorIncidentCandidate;
}

export interface DoctorNotificationGroup {
  key: string;
  items: DoctorNotificationItem[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function parseDiagnosisJson(value: string | null): {
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

export function candidateDiagnosis(candidate: DoctorIncidentCandidate): {
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

export function sourceRoute(candidate: DoctorIncidentCandidate): string | undefined {
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

export function notificationProblemText(candidate: DoctorIncidentCandidate, report: DoctorReport): string {
  return taskResultSummary(candidate)
    ?? traceErrorMessage(candidate)
    ?? cronError(candidate)
    ?? candidate.summary
    ?? report.diagnosis.summary;
}

export function normalizeNotificationSignature(text: string): string {
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
  const incidentDiagnosis = parseDiagnosisJson(item.incident.diagnosis_json);
  const category = diagnosis.category ?? incidentDiagnosis.category ?? report.diagnosis.category;
  const repairAllowed = diagnosis.repairAllowed ?? incidentDiagnosis.repairAllowed ?? false;
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

export function groupDoctorNotifications(items: DoctorNotificationItem[], report: DoctorReport): DoctorNotificationGroup[] {
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
