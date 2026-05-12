import type { IncidentRow } from "../../store/incidents.js";
import { parseDiagnosisJson } from "./grouping.js";

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

export interface DoctorRepairLimitPolicy {
  maxParallelRepairs: number;
  maxRepairsPerDay: number;
  activeRepairs: number;
  repairsToday: number;
}

export function startOfUtcDayIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export function canAttemptRepair(incident: IncidentRow): DoctorRepairSkipReason | undefined {
  if (!["open", "diagnosed"].includes(incident.status)) return "status_not_repairable";
  const diagnosis = parseDiagnosisJson(incident.diagnosis_json);
  if (diagnosis.repairAllowed !== true) return "not_repair_allowed";
  return undefined;
}

export function parallelRepairLimitSkip(
  incident: IncidentRow,
  activeRepairs: number,
  maxParallelRepairs: number,
): DoctorRepairSkip | undefined {
  if (activeRepairs >= maxParallelRepairs) {
    return { incident, reason: "max_parallel_repairs", message: `active=${activeRepairs}` };
  }
  return undefined;
}

export function dailyRepairLimitSkip(
  incident: IncidentRow,
  repairsToday: number,
  maxRepairsPerDay: number,
): DoctorRepairSkip | undefined {
  if (repairsToday >= maxRepairsPerDay) {
    return { incident, reason: "max_repairs_per_day", message: `today=${repairsToday}` };
  }
  return undefined;
}

export function repairLimitSkip(incident: IncidentRow, policy: DoctorRepairLimitPolicy): DoctorRepairSkip | undefined {
  return parallelRepairLimitSkip(incident, policy.activeRepairs, policy.maxParallelRepairs)
    ?? dailyRepairLimitSkip(incident, policy.repairsToday, policy.maxRepairsPerDay);
}
