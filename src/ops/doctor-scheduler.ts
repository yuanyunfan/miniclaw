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
import { doctorSummaryChannelEventTarget } from "./doctor-discord.js";
import { deriveDoctorIncidentCandidates } from "./doctor-incidents.js";
import { runDoctorRepair, type DoctorRepairResult } from "./doctor-repair.js";
import {
  groupDoctorNotifications,
  type DoctorNotificationGroup,
  type DoctorNotificationItem,
} from "./doctor-scheduler/grouping.js";
import {
  formatDoctorNotificationGroup,
  formatDoctorNotificationGroups,
  formatIncidentNotification,
  formatRepairNotification,
  sendDoctorNotification,
  sendDoctorRepairNotification,
} from "./doctor-scheduler/notifications.js";
import {
  canAttemptRepair,
  dailyRepairLimitSkip,
  parallelRepairLimitSkip,
  repairLimitSkip,
  startOfUtcDayIso,
  type DoctorRepairSkip,
} from "./doctor-scheduler/repair-policy.js";
import { createDoctorSchedulerState, logFingerprint } from "./doctor-scheduler/state.js";

export type { DoctorNotificationGroup, DoctorNotificationItem } from "./doctor-scheduler/grouping.js";
export type { DoctorRepairSkip, DoctorRepairSkipReason } from "./doctor-scheduler/repair-policy.js";

const log = createLogger("doctor-scheduler");

export interface DoctorScanResult {
  skipped?: "disabled" | "draining" | "already_running" | "no_new_logs";
  report?: DoctorReport;
  created: IncidentRow[];
  updated: IncidentRow[];
  notified: IncidentRow[];
  repaired: DoctorRepairResult[];
  repairSkipped: DoctorRepairSkip[];
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

const REPAIR_SKIP_EVENT_REASONS = new Set<DoctorRepairSkip["reason"]>([
  "max_parallel_repairs",
  "max_repairs_per_day",
  "repair_error",
]);

function shouldNotify(result: CreateOrUpdateIncidentResult): boolean {
  return result.created || result.severityEscalated;
}

function doctorSkipResult(skipped: DoctorScanResult["skipped"]): DoctorScanResult {
  return {
    skipped,
    created: [],
    updated: [],
    notified: [],
    repaired: [],
    repairSkipped: [],
  };
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
  const schedulerState = createDoctorSchedulerState();

  const maybeRunRepair = async (incident: IncidentRow): Promise<DoctorRepairResult | DoctorRepairSkip | null> => {
    if (!config.doctor.autoRepairEnabled) return null;
    const policySkip = canAttemptRepair(incident);
    if (policySkip) return { incident, reason: policySkip };

    const activeRepairs = countRepairRunsByStatusFn(["repairing"]);
    const parallelSkip = parallelRepairLimitSkip(incident, activeRepairs, config.doctor.maxParallelRepairs);
    if (parallelSkip) return parallelSkip;

    const repairsToday = countRepairRunsSinceFn(startOfUtcDayIso(nowFn()));
    const dailySkip = dailyRepairLimitSkip(incident, repairsToday, config.doctor.maxRepairsPerDay);
    if (dailySkip) return dailySkip;

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
        return doctorSkipResult("disabled");
      }
      if (drainingFn()) {
        return doctorSkipResult("draining");
      }
      if (schedulerState.isRunning()) {
        return doctorSkipResult("already_running");
      }
      if (reason === "interval") {
        const currentLogFingerprint = logFingerprintFn();
        if (schedulerState.shouldSkipUnchangedInterval(reason, currentLogFingerprint)) {
          return doctorSkipResult("no_new_logs");
        }
      }

      if (!schedulerState.beginRun()) {
        return doctorSkipResult("already_running");
      }
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
              if (REPAIR_SKIP_EVENT_REASONS.has(repairOutcome.reason)) {
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
        schedulerState.rememberLogFingerprint(logFingerprintFn());
        return { report, created, updated, notified, repaired, repairSkipped };
      } catch (err) {
        log.error("doctor scan failed:", err);
        throw err;
      } finally {
        schedulerState.finishRun();
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
  canAttemptRepair,
  createDoctorSchedulerState,
  formatIncidentNotification,
  formatDoctorNotificationGroup,
  formatDoctorNotificationGroups,
  groupDoctorNotifications,
  formatRepairNotification,
  logFingerprint,
  repairLimitSkip,
  startOfUtcDayIso,
};
