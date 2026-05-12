import type {
  DoctorCategory,
  DoctorConnectivityState,
  DoctorDiagnosis,
  DoctorEvidence,
  DoctorGitState,
  DoctorIncidentType,
  DoctorSeverity,
} from "./types.js";

function classifyCategory(text: string, connectivity: DoctorConnectivityState): DoctorCategory {
  if (connectivity.status && !["discord_ok", "recovered"].includes(connectivity.status)) {
    if (connectivity.status.includes("discord") || connectivity.status.includes("vpn")) return "discord";
    return "network";
  }
  if (/(discord_delivery_failed|discord|missing access|unknown message|cannot send messages|message send|message edit)/i.test(text)) return "discord";
  if (/(reconnecting|stream disconnected|stream closed|connection reset|socket hang up|fetch failed|network error|network down|proxy error|vpn disconnected)/i.test(text)) return "network";
  if (/(cookie|auth|unauthori[sz]ed|forbidden|credential|session expired|login|登录|鉴权|认证)/i.test(text)) return "provider_auth";
  if (/(no new|not found|empty|没有|无新|0 条|0条|no data|data absence)/i.test(text)) return "provider_data";
  if (/(timeout|429|rate limit|econn|enotfound|http 5\d\d|upstream|third[- ]party)/i.test(text)) return "third_party";
  if (/(typeerror|referenceerror|syntaxerror|assertion|schema|migration|cannot read|undefined|exception|bug)/i.test(text)) return "miniclaw_bug";
  return "unknown";
}

function isRepairAllowed(type: DoctorIncidentType, category: DoctorCategory, git: DoctorGitState): boolean {
  if (git.dirtyFiles.length > 0) return false;
  if (!["miniclaw_bug", "unknown"].includes(category)) return false;
  return ["task_failed", "cron_failed", "chat_error"].includes(type);
}

function buildSummary(type: DoctorIncidentType, category: DoctorCategory): string {
  if (type === "unknown") return "Doctor did not find a clear failing task, cron error, Discord outage, or PM2 restart loop.";
  if (category === "discord" || category === "network") return "The strongest signal points to connectivity rather than a code repair.";
  if (category === "provider_auth") return "The strongest signal points to provider authentication/session health.";
  if (category === "provider_data") return "The strongest signal points to missing or empty upstream data.";
  if (category === "miniclaw_bug") return "The strongest signal points to a MiniClaw code/runtime bug.";
  return "The incident needs human review before deciding whether it is repairable.";
}

function recommendedActionFor(type: DoctorIncidentType, category: DoctorCategory, git: DoctorGitState): string {
  if (git.dirtyFiles.length > 0) return "Workspace has dirty files; review them before any repair workflow.";
  if (category === "discord" || category === "network") return "Check VPN/proxy/network and Discord reachability before changing code.";
  if (category === "provider_auth") return "Refresh or diagnose the provider session/auth path; do not auto-repair credentials.";
  if (category === "provider_data") return "Verify upstream data availability and cron/provider filters.";
  if (type === "task_interrupted") return "Use /resume if a provider session exists; inspect restart/drain logs before changing code.";
  return "Review evidence and decide whether to create a focused repair task.";
}

export function diagnoseDoctorEvidence(evidence: DoctorEvidence): DoctorDiagnosis {
  const traceText = evidence.taskEvents.map((event) => [
    event.event_type,
    event.severity,
    event.message,
    event.payload_json,
  ].filter(Boolean).join(" ")).join("\n");
  const subjectText = [
    evidence.task?.status,
    evidence.task?.result_summary,
    evidence.task?.prompt,
    traceText,
    evidence.cron?.last_error,
    evidence.cronErrors[0]?.last_error,
    evidence.logs.flatMap((log) => log.lines).slice(-20).join("\n"),
  ].filter(Boolean).join("\n");

  let incidentType: DoctorIncidentType = "unknown";
  let title = "No clear MiniClaw incident found";
  const evidenceSummary: string[] = [];

  if (evidence.mode === "task" && !evidence.task) {
    title = `Task not found: ${evidence.subject ?? ""}`.trim();
  } else if (evidence.mode === "cron" && evidence.cron?.last_status === "error") {
    incidentType = "cron_failed";
    title = `Cron failed: ${evidence.cron.name}`;
  } else if (evidence.mode === "cron" && !evidence.cron) {
    title = `Cron job not found: ${evidence.subject ?? ""}`.trim();
  } else if (evidence.task?.status === "failed") {
    incidentType = "task_failed";
    title = `Task failed: ${evidence.task.id.slice(0, 8)}`;
  } else if (evidence.task?.status === "interrupted") {
    incidentType = "task_interrupted";
    title = `Task interrupted: ${evidence.task.id.slice(0, 8)}`;
  } else if (evidence.task?.status === "running") {
    incidentType = "task_running_too_long";
    title = `Task still running: ${evidence.task.id.slice(0, 8)}`;
  } else if (evidence.cronErrors.length) {
    incidentType = "cron_failed";
    title = `Recent cron failure: ${evidence.cronErrors[0].name}`;
  } else if (evidence.connectivity.status && !["discord_ok", "recovered"].includes(evidence.connectivity.status)) {
    incidentType = "discord_outage";
    title = `Connectivity degraded: ${evidence.connectivity.status}`;
  } else if ((evidence.pm2.unstableRestarts ?? 0) > 0) {
    incidentType = "pm2_restart_loop";
    title = `PM2 app has unstable restarts: ${evidence.pm2.app}`;
  }

  if (evidence.task) {
    evidenceSummary.push(`task=${evidence.task.id.slice(0, 8)} status=${evidence.task.status}`);
    if (evidence.task.result_summary) evidenceSummary.push(`task_result=${evidence.task.result_summary.slice(0, 180)}`);
    if (evidence.task.source_route_type) evidenceSummary.push(`route=${evidence.task.source_route_type}`);
  }
  const traceErrors = evidence.taskEvents
    .filter((event) => ["warning", "error"].includes(event.severity))
    .slice(0, 3)
    .map((event) => `${event.task_id.slice(0, 8)}:${event.event_type}${event.message ? `=${event.message.slice(0, 120)}` : ""}`);
  if (traceErrors.length) {
    evidenceSummary.push(`trace_errors=${traceErrors.join(" | ")}`);
  } else if (evidence.taskEvents.length) {
    const recentTrace = evidence.taskEvents.slice(0, 3).map((event) => `${event.task_id.slice(0, 8)}:${event.event_type}`);
    evidenceSummary.push(`trace=${recentTrace.join(" | ")}`);
  }
  if (evidence.cron) {
    evidenceSummary.push(`cron=${evidence.cron.name} status=${evidence.cron.last_status ?? "unknown"}`);
    if (evidence.cron.last_error) evidenceSummary.push(`cron_error=${evidence.cron.last_error.slice(0, 180)}`);
  } else if (evidence.cronErrors.length) {
    evidenceSummary.push(`cron_errors=${evidence.cronErrors.map((job) => job.name).join(", ")}`);
  }
  if (evidence.connectivity.status) {
    evidenceSummary.push(`connectivity=${evidence.connectivity.status} failures=${evidence.connectivity.consecutive_failures ?? 0}`);
  }
  if (evidence.pm2.found) {
    evidenceSummary.push(`pm2=${evidence.pm2.status ?? "unknown"} restarts=${evidence.pm2.restartCount ?? 0}`);
  } else if (evidence.pm2.error) {
    evidenceSummary.push(`pm2_unavailable=${evidence.pm2.error.slice(0, 120)}`);
  }
  if (evidence.git.sha) {
    evidenceSummary.push(`git=${evidence.git.branch ?? "unknown"}@${evidence.git.sha} dirty=${evidence.git.dirtyFiles.length}`);
  }

  const category = classifyCategory(subjectText, evidence.connectivity);
  const severity: DoctorSeverity = incidentType === "pm2_restart_loop" || incidentType === "discord_outage"
    ? "critical"
    : incidentType === "unknown"
      ? "info"
      : "warning";
  const repairAllowed = isRepairAllowed(incidentType, category, evidence.git);
  const recommendedAction = repairAllowed
    ? "This looks potentially repairable, but Phase 1 is read-only. Run a manual task or future doctor:repair flow after reviewing the evidence."
    : recommendedActionFor(incidentType, category, evidence.git);

  return {
    incidentType,
    severity,
    category,
    title,
    summary: buildSummary(incidentType, category),
    evidenceSummary,
    repairAllowed,
    recommendedAction,
  };
}
