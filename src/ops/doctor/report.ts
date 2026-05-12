import type { DoctorReport } from "./types.js";

export function formatDoctorReport(report: DoctorReport): string {
  const d = report.diagnosis;
  const e = report.evidence;
  const lines = [
    `MiniClaw Doctor: ${d.title}`,
    "",
    `Type: ${d.incidentType}`,
    `Severity: ${d.severity}`,
    `Category: ${d.category}`,
    `Repair allowed: ${d.repairAllowed ? "yes" : "no"}`,
    "",
    d.summary,
    "",
    "Evidence:",
    ...d.evidenceSummary.map((line) => `- ${line}`),
    "",
    "Next action:",
    d.recommendedAction,
    "",
    `Generated: ${e.generatedAt}`,
  ];

  const logLines = e.logs.flatMap((log) => log.lines.map((line) => `${log.path}: ${line}`)).slice(-8);
  if (logLines.length) {
    lines.push("", "Recent matching log lines:", ...logLines.map((line) => `- ${line.slice(0, 260)}`));
  }
  if (e.taskEvents.length) {
    lines.push(
      "",
      "Recent task trace events:",
      ...e.taskEvents.slice(0, 8).map((event) => {
        const msg = event.message ? ` ${event.message}` : "";
        return `- ${event.created_at} ${event.task_id.slice(0, 8)} ${event.severity}/${event.event_type}${msg}`.slice(0, 260);
      })
    );
  }

  return lines.join("\n");
}
