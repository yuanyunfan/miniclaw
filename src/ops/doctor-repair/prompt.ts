import type { IncidentRow } from "../../store/incidents.js";

export interface RepairPromptPolicy {
  allowedPaths: readonly string[];
  blockedPaths: readonly string[];
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function buildRepairPrompt(incident: IncidentRow, policy: RepairPromptPolicy): string {
  return [
    "You are MiniClaw Self-Repair Worker.",
    "",
    "Goal: produce the smallest safe code fix for the incident below in this isolated worktree.",
    "",
    "Rules:",
    "- Do not edit secrets, credentials, cookies, sessions, runtime DBs, logs, or user config.",
    "- Keep changes within the configured allowed paths.",
    "- Add or update focused tests when the bug is testable.",
    "- Run targeted verification and report exact commands.",
    "- Do not restart MiniClaw, push to main, force-push, or modify the original worktree.",
    "",
    "Incident:",
    JSON.stringify({
      id: incident.id,
      type: incident.type,
      severity: incident.severity,
      status: incident.status,
      title: incident.title,
      summary: incident.summary,
      subject_id: incident.subject_id,
      subject_type: incident.subject_type,
      source: parseJsonObject(incident.source_json),
      evidence: parseJsonObject(incident.evidence_json),
      diagnosis: parseJsonObject(incident.diagnosis_json),
    }, null, 2),
    "",
    "Allowed paths:",
    ...policy.allowedPaths.map((path) => `- ${path}`),
    "",
    "Blocked paths:",
    ...policy.blockedPaths.map((path) => `- ${path}`),
  ].join("\n");
}
