import type {
  DoctorCategory,
  DoctorCronJobState,
  DoctorDiagnosis,
  DoctorEvidence,
  DoctorIncidentType,
  DoctorReport,
  DoctorSeverity,
  DoctorTaskRow,
} from "./doctor.js";
import type { IncidentInput } from "../store/incidents.js";

export interface DoctorIncidentCandidate extends IncidentInput {
  notify: boolean;
}

function taskIncidentType(status: string): DoctorIncidentType | undefined {
  if (status === "failed") return "task_failed";
  if (status === "interrupted") return "task_interrupted";
  if (status === "running") return "task_running_too_long";
  return undefined;
}

function taskTitle(type: DoctorIncidentType, task: DoctorTaskRow): string {
  const id = task.id.slice(0, 8);
  if (type === "task_failed") return `Task failed: ${id}`;
  if (type === "task_interrupted") return `Task interrupted: ${id}`;
  return `Task still running: ${id}`;
}

function taskSeverity(type: DoctorIncidentType): DoctorSeverity {
  return type === "task_running_too_long" ? "warning" : "warning";
}

function cronDedupePart(cron: DoctorCronJobState): string {
  return cron.failure_run_id ?? cron.last_run_at ?? "unknown";
}

function summaryFor(type: DoctorIncidentType, diagnosis: DoctorDiagnosis): string {
  if (type === diagnosis.incidentType) return diagnosis.summary;
  if (type === "task_failed") return "A Discord task ended with failed status.";
  if (type === "task_interrupted") return "A Discord task was interrupted and may need resume or recovery.";
  if (type === "task_running_too_long") return "A Discord task has been running longer than the doctor threshold.";
  if (type === "cron_failed") return "A scheduled cron job recently failed.";
  if (type === "discord_outage") return "Connectivity state indicates MiniClaw or Discord reachability is degraded.";
  if (type === "pm2_restart_loop") return "PM2 reports unstable restarts for the MiniClaw app.";
  return diagnosis.summary;
}

function categoryFor(type: DoctorIncidentType, diagnosis: DoctorDiagnosis): DoctorCategory {
  if (type === diagnosis.incidentType) return diagnosis.category;
  if (type === "discord_outage") return "discord";
  return "unknown";
}

function hourBucket(iso: string): string {
  return iso.slice(0, 13);
}

function taskCandidate(task: DoctorTaskRow, evidence: DoctorEvidence, diagnosis: DoctorDiagnosis): DoctorIncidentCandidate | undefined {
  const type = taskIncidentType(task.status);
  if (!type) return undefined;
  return {
    dedupeKey: `task:${task.id}:${task.status}`,
    type,
    severity: taskSeverity(type),
    title: taskTitle(type, task),
    summary: summaryFor(type, diagnosis),
    subjectId: task.id,
    subjectType: "task",
    source: {
      task_id: task.id,
      status: task.status,
      route: task.source_route_type,
      channel_id: task.source_channel_id,
      message_url: task.source_message_url,
      created_at: task.created_at,
      completed_at: task.completed_at,
    },
    evidence: {
      task,
      generated_at: evidence.generatedAt,
      logs: evidence.logs.flatMap((log) => log.lines).slice(-8),
    },
    diagnosis: {
      incidentType: type,
      severity: taskSeverity(type),
      category: categoryFor(type, diagnosis),
      repairAllowed: type === diagnosis.incidentType ? diagnosis.repairAllowed : false,
      recommendedAction: diagnosis.recommendedAction,
    },
    notify: true,
  };
}

function cronCandidate(cron: DoctorCronJobState, evidence: DoctorEvidence, diagnosis: DoctorDiagnosis): DoctorIncidentCandidate {
  return {
    dedupeKey: `cron:${cron.name}:${cronDedupePart(cron)}`,
    type: "cron_failed",
    severity: "warning",
    title: `Cron failed: ${cron.name}`,
    summary: summaryFor("cron_failed", diagnosis),
    subjectId: cron.name,
    subjectType: "cron",
    source: {
      cron_name: cron.name,
      last_run_at: cron.last_run_at,
      failure_run_id: cron.failure_run_id,
      last_attempt: cron.last_attempt,
      max_attempts: cron.max_attempts,
    },
    evidence: {
      cron,
      generated_at: evidence.generatedAt,
      logs: evidence.logs.flatMap((log) => log.lines).slice(-8),
    },
    diagnosis: {
      incidentType: "cron_failed",
      severity: "warning",
      category: categoryFor("cron_failed", diagnosis),
      repairAllowed: diagnosis.incidentType === "cron_failed" ? diagnosis.repairAllowed : false,
      recommendedAction: diagnosis.recommendedAction,
    },
    notify: true,
  };
}

export function deriveDoctorIncidentCandidates(report: DoctorReport): DoctorIncidentCandidate[] {
  const { evidence, diagnosis } = report;
  const candidates: DoctorIncidentCandidate[] = [];
  const seen = new Set<string>();

  const push = (candidate: DoctorIncidentCandidate | undefined) => {
    if (!candidate || seen.has(candidate.dedupeKey)) return;
    seen.add(candidate.dedupeKey);
    candidates.push(candidate);
  };

  for (const task of evidence.taskCandidates) {
    push(taskCandidate(task, evidence, diagnosis));
  }

  for (const cron of evidence.cronErrors) {
    push(cronCandidate(cron, evidence, diagnosis));
  }

  if (evidence.connectivity.status && !["discord_ok", "recovered"].includes(evidence.connectivity.status)) {
    push({
      dedupeKey: `connectivity:${evidence.connectivity.status}:${hourBucket(evidence.generatedAt)}`,
      type: "discord_outage",
      severity: "critical",
      title: `Connectivity degraded: ${evidence.connectivity.status}`,
      summary: summaryFor("discord_outage", diagnosis),
      subjectId: evidence.connectivity.status,
      subjectType: "connectivity",
      source: evidence.connectivity,
      evidence: {
        connectivity: evidence.connectivity,
        generated_at: evidence.generatedAt,
        logs: evidence.logs.flatMap((log) => log.lines).slice(-8),
      },
      diagnosis: {
        incidentType: "discord_outage",
        severity: "critical",
        category: "discord",
        repairAllowed: false,
        recommendedAction: diagnosis.recommendedAction,
      },
      notify: true,
    });
  }

  if ((evidence.pm2.unstableRestarts ?? 0) > 0) {
    push({
      dedupeKey: `pm2:${evidence.pm2.app}:${hourBucket(evidence.generatedAt)}`,
      type: "pm2_restart_loop",
      severity: "critical",
      title: `PM2 app has unstable restarts: ${evidence.pm2.app}`,
      summary: summaryFor("pm2_restart_loop", diagnosis),
      subjectId: evidence.pm2.app,
      subjectType: "pm2",
      source: evidence.pm2,
      evidence: {
        pm2: evidence.pm2,
        generated_at: evidence.generatedAt,
        logs: evidence.logs.flatMap((log) => log.lines).slice(-8),
      },
      diagnosis: {
        incidentType: "pm2_restart_loop",
        severity: "critical",
        category: "unknown",
        repairAllowed: false,
        recommendedAction: diagnosis.recommendedAction,
      },
      notify: true,
    });
  }

  return candidates;
}
