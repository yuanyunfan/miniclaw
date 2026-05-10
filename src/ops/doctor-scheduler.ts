import type { Client, SendableChannels } from "discord.js";
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
import { deriveDoctorIncidentCandidates, type DoctorIncidentCandidate } from "./doctor-incidents.js";
import { runDoctorRepair, type DoctorRepairResult } from "./doctor-repair.js";

const log = createLogger("doctor-scheduler");

export interface DoctorScanResult {
  skipped?: "disabled" | "draining" | "already_running";
  report?: DoctorReport;
  created: IncidentRow[];
  updated: IncidentRow[];
  notified: IncidentRow[];
  repaired: DoctorRepairResult[];
  repairSkipped: DoctorRepairSkip[];
}

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
  sendNotificationFn?: (client: Client, incident: IncidentRow, candidate: DoctorIncidentCandidate, report: DoctorReport) => Promise<void>;
  sendRepairNotificationFn?: (client: Client, result: DoctorRepairResult) => Promise<void>;
  drainingFn?: () => boolean;
  nowFn?: () => Date;
};

function shouldNotify(result: CreateOrUpdateIncidentResult): boolean {
  return result.created || result.severityEscalated;
}

function parseDiagnosisJson(value: string | null): { repairAllowed?: boolean; recommendedAction?: string } {
  if (!value) return {};
  try {
    return JSON.parse(value) as { repairAllowed?: boolean; recommendedAction?: string };
  } catch {
    return {};
  }
}

function startOfUtcDayIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function canAttemptRepair(incident: IncidentRow): DoctorRepairSkipReason | undefined {
  if (!["open", "diagnosed"].includes(incident.status)) return "status_not_repairable";
  const diagnosis = parseDiagnosisJson(incident.diagnosis_json);
  if (diagnosis.repairAllowed !== true) return "not_repair_allowed";
  return undefined;
}

function formatIncidentNotification(incident: IncidentRow, candidate: DoctorIncidentCandidate, report: DoctorReport): string {
  const diagnosis = parseDiagnosisJson(incident.diagnosis_json);
  const lines = [
    `🩺 MiniClaw Doctor: ${incident.title}`,
    "",
    `Incident: \`${incident.id.slice(0, 8)}\``,
    `Type: \`${incident.type}\``,
    `Severity: \`${incident.severity}\``,
    `Subject: \`${incident.subject_type ?? "unknown"}:${incident.subject_id ?? "-"}\``,
    `Repair allowed: ${diagnosis.repairAllowed ? "yes" : "no"}`,
    "",
    incident.summary ?? "Auto Doctor created an incident.",
    "",
    "Evidence:",
    ...report.diagnosis.evidenceSummary.slice(0, 6).map((line) => `- ${line}`),
    "",
    "Next action:",
    diagnosis.recommendedAction ?? report.diagnosis.recommendedAction,
  ];

  if (!candidate.notify) {
    lines.push("", "Notification reason: internal scan only.");
  }
  return lines.join("\n").slice(0, 1900);
}

async function fetchSendableChannel(client: Client, channelId: string): Promise<SendableChannels | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && "isSendable" in channel && channel.isSendable()) return channel as SendableChannels;
  } catch (err) {
    log.error(`failed to fetch doctor summary channel ${channelId}:`, err);
  }
  return null;
}

async function sendDoctorNotification(
  client: Client,
  incident: IncidentRow,
  candidate: DoctorIncidentCandidate,
  report: DoctorReport
): Promise<void> {
  const channelId = config.doctor.summaryChannelId;
  if (!channelId) {
    log.warn(`doctor incident ${incident.id} has no summary channel configured`);
    return;
  }
  const channel = await fetchSendableChannel(client, channelId);
  if (!channel) return;
  await channel.send(formatIncidentNotification(incident, candidate, report));
}

function formatRepairNotification(result: DoctorRepairResult): string {
  const lines = [
    `MiniClaw Doctor Repair: ${result.ok ? "ready" : "blocked"}`,
    "",
    `Incident: \`${result.incident.id.slice(0, 8)}\` ${result.incident.title}`,
    `Mode: ${result.dryRun ? "dry-run" : "execute"}`,
    `Workspace: \`${result.workspacePath}\``,
    `Branch: \`${result.branch}\``,
    ...(result.commitSha ? [`Commit: \`${result.commitSha.slice(0, 12)}\``] : []),
    ...(result.pushed ? [`Pushed: \`${result.pushTarget ?? "yes"}\``] : []),
    ...(result.pushError ? [`Push error: ${result.pushError.slice(0, 240)}`] : []),
    `Message: ${result.message}`,
    "",
    "Changed files:",
    ...(result.changedFiles.length ? result.changedFiles.map((file) => `- ${file}`) : ["- (none)"]),
    "",
    "Verification:",
    ...(result.verification.length
      ? result.verification.map((item) => `- ${item.ok ? "ok" : "failed"}: ${item.command}`)
      : ["- (not run)"]),
  ];
  if (result.policy.blockers.length) {
    lines.push("", "Policy blockers:", ...result.policy.blockers.map((item) => `- ${item}`));
  }
  if (result.agent?.response) {
    lines.push("", "Agent report:", result.agent.response.slice(0, 600));
  }
  return lines.join("\n").slice(0, 1900);
}

async function sendDoctorRepairNotification(client: Client, result: DoctorRepairResult): Promise<void> {
  const channelId = config.doctor.summaryChannelId;
  if (!channelId) {
    log.warn(`doctor repair ${result.repairRun?.id ?? "(unknown)"} has no summary channel configured`);
    return;
  }
  const channel = await fetchSendableChannel(client, channelId);
  if (!channel) return;
  await channel.send(formatRepairNotification(result));
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
  let running = false;

  const skipResult = (skipped: DoctorScanResult["skipped"]): DoctorScanResult => ({
    skipped,
    created: [],
    updated: [],
    notified: [],
    repaired: [],
    repairSkipped: [],
  });

  const maybeRunRepair = async (incident: IncidentRow): Promise<DoctorRepairResult | DoctorRepairSkip | null> => {
    if (!config.doctor.autoRepairEnabled) return null;
    const policySkip = canAttemptRepair(incident);
    if (policySkip) return { incident, reason: policySkip };

    const activeRepairs = countRepairRunsByStatusFn(["repairing"]);
    if (activeRepairs >= config.doctor.maxParallelRepairs) {
      return { incident, reason: "max_parallel_repairs", message: `active=${activeRepairs}` };
    }

    const repairsToday = countRepairRunsSinceFn(startOfUtcDayIso(nowFn()));
    if (repairsToday >= config.doctor.maxRepairsPerDay) {
      return { incident, reason: "max_repairs_per_day", message: `today=${repairsToday}` };
    }

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
          channel_id: config.doctor.summaryChannelId,
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
        return skipResult("disabled");
      }
      if (drainingFn()) {
        return skipResult("draining");
      }
      if (running) {
        return skipResult("already_running");
      }

      running = true;
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
            await sendNotificationFn(client, result.row, candidate, report);
            appendIncidentEventFn(result.row.id, "doctor_notified", {
              channel_id: config.doctor.summaryChannelId,
              reason,
            });
            notified.push(result.row);
          }

          const repairOutcome = await maybeRunRepair(result.row);
          if (repairOutcome) {
            if ("reason" in repairOutcome) {
              repairSkipped.push(repairOutcome);
              if (["max_parallel_repairs", "max_repairs_per_day", "repair_error"].includes(repairOutcome.reason)) {
                appendIncidentEventFn(result.row.id, "repair_skipped", {
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
        return { report, created, updated, notified, repaired, repairSkipped };
      } catch (err) {
        log.error("doctor scan failed:", err);
        throw err;
      } finally {
        running = false;
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
  run("startup");

  const originalStop = handle.stop.bind(handle);
  handle.stop = () => {
    originalStop();
    clearInterval(timer);
  };
  log.info(`Auto Doctor scheduler started: interval=${config.doctor.scanIntervalMs}ms`);
  return handle;
}

export const __testables = {
  formatIncidentNotification,
  formatRepairNotification,
  startOfUtcDayIso,
};
