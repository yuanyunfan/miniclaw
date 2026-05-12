import type { IncidentRow } from "../../store/incidents.js";

export interface RepairPolicyOptions {
  execute: boolean;
  force: boolean;
  autoRepairEnabled: boolean;
}

export interface RepairPolicyResult {
  allowed: boolean;
  blockers: string[];
  warnings: string[];
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

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function booleanField(obj: Record<string, unknown>, key: string): boolean | undefined {
  return typeof obj[key] === "boolean" ? obj[key] : undefined;
}

export function evaluateRepairPolicy(
  incident: IncidentRow,
  options: RepairPolicyOptions,
): RepairPolicyResult {
  const diagnosis = parseJsonObject(incident.diagnosis_json);
  const category = stringField(diagnosis, "category");
  const repairAllowed = booleanField(diagnosis, "repairAllowed") === true;
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (["resolved", "ignored"].includes(incident.status)) blockers.push(`incident status is ${incident.status}`);
  if (!repairAllowed && !options.force) blockers.push("diagnosis does not allow repair");
  if (["provider_auth", "provider_data", "network", "discord", "third_party"].includes(category ?? "")) {
    blockers.push(`category ${category} is not auto-repairable`);
  }
  if (!["task_failed", "cron_failed", "chat_error"].includes(incident.type) && !options.force) {
    blockers.push(`incident type ${incident.type} is not repairable by policy`);
  }
  if (options.execute && !options.autoRepairEnabled && !options.force) {
    blockers.push("doctor.auto_repair_enabled is false");
  }
  if (options.force) warnings.push("--force bypasses repairAllowed/type/config gates but not path verification");

  return { allowed: blockers.length === 0, blockers, warnings };
}
