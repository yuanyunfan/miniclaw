import {
  listCronRuns,
  resolveCronRunByIdPrefix,
} from "../store/cron-runs.js";
import {
  formatCronRunDetail,
  formatCronRunList,
  formatCronRunLookupError,
} from "../cron/run-history-format.js";

const DISCORD_CONTENT_LIMIT = 1900;
const DEFAULT_CRON_RUN_LIMIT = 10;
const MAX_CRON_RUN_LIMIT = 25;

function clipDiscordContent(value: string): string {
  const suffix = "\n... truncated for Discord";
  return value.length > DISCORD_CONTENT_LIMIT
    ? `${value.slice(0, DISCORD_CONTENT_LIMIT - suffix.length)}${suffix}`
    : value;
}

export function normalizeCronRunLimit(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return DEFAULT_CRON_RUN_LIMIT;
  return Math.min(MAX_CRON_RUN_LIMIT, Math.max(1, Math.floor(value)));
}

export function buildCronRunsReply(options: {
  jobName?: string | null;
  limit?: number | null;
} = {}): string {
  const jobName = options.jobName?.trim() || undefined;
  const rows = listCronRuns({
    jobName,
    limit: normalizeCronRunLimit(options.limit),
  });
  return clipDiscordContent(formatCronRunList(rows));
}

export function buildCronRunDetailReply(idPrefix: string): string {
  const resolved = resolveCronRunByIdPrefix(idPrefix);
  if (!resolved.ok) return `❌ ${formatCronRunLookupError(resolved.error)}`;
  return clipDiscordContent(formatCronRunDetail(resolved.value));
}
