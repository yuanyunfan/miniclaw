import type { Client, SendableChannels } from "discord.js";
import { config } from "../config.js";
import { createLogger } from "../lib/log.js";
import { isDraining } from "../runtime/shutdown.js";
import {
  appendIncidentEvent,
  createOrUpdateIncident,
  type CreateOrUpdateIncidentResult,
  type IncidentRow,
} from "../store/incidents.js";
import { runDoctor, type DoctorReport } from "./doctor.js";
import { deriveDoctorIncidentCandidates, type DoctorIncidentCandidate } from "./doctor-incidents.js";

const log = createLogger("doctor-scheduler");

export interface DoctorScanResult {
  skipped?: "disabled" | "draining" | "already_running";
  report?: DoctorReport;
  created: IncidentRow[];
  updated: IncidentRow[];
  notified: IncidentRow[];
}

export interface DoctorSchedulerHandle {
  runOnce(reason?: string): Promise<DoctorScanResult>;
  stop(): void;
}

type DoctorSchedulerDeps = {
  runDoctorFn?: typeof runDoctor;
  createOrUpdateIncidentFn?: typeof createOrUpdateIncident;
  appendIncidentEventFn?: typeof appendIncidentEvent;
  sendNotificationFn?: (client: Client, incident: IncidentRow, candidate: DoctorIncidentCandidate, report: DoctorReport) => Promise<void>;
  drainingFn?: () => boolean;
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

export function createDoctorScheduler(
  client: Client,
  deps: DoctorSchedulerDeps = {}
): DoctorSchedulerHandle {
  const runDoctorFn = deps.runDoctorFn ?? runDoctor;
  const createOrUpdateIncidentFn = deps.createOrUpdateIncidentFn ?? createOrUpdateIncident;
  const appendIncidentEventFn = deps.appendIncidentEventFn ?? appendIncidentEvent;
  const sendNotificationFn = deps.sendNotificationFn ?? sendDoctorNotification;
  const drainingFn = deps.drainingFn ?? isDraining;
  let running = false;

  return {
    async runOnce(reason = "manual"): Promise<DoctorScanResult> {
      if (!config.doctor.enabled || !config.doctor.autoDiagnoseEnabled) {
        return { skipped: "disabled", created: [], updated: [], notified: [] };
      }
      if (drainingFn()) {
        return { skipped: "draining", created: [], updated: [], notified: [] };
      }
      if (running) {
        return { skipped: "already_running", created: [], updated: [], notified: [] };
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
        }

        if (candidates.length === 0) {
          log.info("doctor scan found no actionable incidents");
        } else {
          log.info(`doctor scan processed ${candidates.length} incident candidate(s): created=${created.length} updated=${updated.length}`);
        }
        return { report, created, updated, notified };
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
};
