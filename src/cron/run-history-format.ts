import type {
  CronRunLookupError,
  CronRunRow,
  CronRunSummaryRow,
} from "../store/cron-runs.js";

function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : "-";
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${seconds.toFixed(seconds % 1 === 0 ? 0 : 1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `${minutes}m${rest}s` : `${minutes}m`;
}

function metadataLines(metadataJson: string | null): string[] {
  if (!metadataJson) return [];
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    return [`- metadata: ${JSON.stringify(parsed)}`];
  } catch {
    return [`- metadata: ${metadataJson.slice(0, 240)}`];
  }
}

function commandLines(row: CronRunRow): string[] {
  const lines = [`- Run detail: pnpm run cron:runs -- --id ${shortId(row.id)}`];
  if (row.task_id) lines.push(`- Task trace: /task-log id:${shortId(row.task_id)}`);
  if (row.incident_id) lines.push(`- Incident: /incident view id:${shortId(row.incident_id)}`);
  return lines;
}

export function formatCronRunDetail(row: CronRunRow): string {
  const lines = [
    `Cron run ${row.id}`,
    "",
    "Status",
    `- job/type: ${row.job_name} / ${row.job_type}`,
    `- status/attempt: ${row.status} / ${row.attempt}`,
    `- scheduled_at: ${row.scheduled_at ?? "-"}`,
    `- started_at: ${row.started_at}`,
    `- completed_at: ${row.completed_at ?? "-"}`,
    `- duration: ${formatDuration(row.duration_ms)}`,
    "",
    "Links",
    `- task_id: ${row.task_id ?? "-"}`,
    `- incident_id: ${row.incident_id ?? "-"}`,
    `- alert: ${row.alert_channel_id ?? "-"} / ${row.alert_message_id ?? "-"}`,
    "",
    "Provider",
    `- name/status/category: ${row.provider_name ?? "-"} / ${row.provider_status ?? "-"} / ${row.provider_category ?? "-"}`,
    "",
    "Error",
    `- category: ${row.error_category ?? "-"}`,
    `- message: ${row.error_message ?? "-"}`,
    ...metadataLines(row.metadata_json),
    "",
    "Operator Commands",
    ...commandLines(row),
  ];
  return lines.join("\n");
}

export function formatCronRunList(rows: CronRunRow[]): string {
  if (!rows.length) return "Cron runs\n\n(none)";
  const lines = [`Cron runs (${rows.length})`];
  let currentJob = "";
  for (const row of rows) {
    if (row.job_name !== currentJob) {
      currentJob = row.job_name;
      lines.push("", currentJob);
    }
    const error = row.error_category ? ` error=${row.error_category}` : "";
    const task = row.task_id ? ` task=${shortId(row.task_id)}` : "";
    const incident = row.incident_id ? ` incident=${shortId(row.incident_id)}` : "";
    lines.push(
      `- ${row.started_at} ${row.status} attempt=${row.attempt} id=${shortId(row.id)} duration=${formatDuration(row.duration_ms)}${task}${incident}${error}`
    );
  }
  return lines.join("\n");
}

export function formatCronRunSummary(rows: CronRunSummaryRow[]): string {
  if (!rows.length) return "Cron run summary\n\n(none)";
  return [
    `Cron run summary (${rows.length} job${rows.length === 1 ? "" : "s"})`,
    "",
    ...rows.map((row) => [
      row.job_name,
      `- last: ${row.last_status} at ${row.last_started_at}`,
      `- counts: total=${row.total_runs} success=${row.success_runs} failed=${row.failed_runs} retry_scheduled=${row.retry_scheduled_runs} missed=${row.missed_runs} skipped=${row.skipped_runs} circuit_open=${row.circuit_open_runs} running=${row.running_runs} cancelled=${row.cancelled_runs}`,
      `- avg_duration: ${formatDuration(row.avg_duration_ms)}`,
    ].join("\n")),
  ].join("\n\n");
}

export function formatCronRunLookupError(error: CronRunLookupError): string {
  if (error.code === "ambiguous_prefix") {
    return `${error.message}: ${error.matches.map(shortId).join(", ")}`;
  }
  return error.message;
}
