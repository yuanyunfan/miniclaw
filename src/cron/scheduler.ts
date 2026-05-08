import cron, { type ScheduledTask } from "node-cron";
import type { Client } from "discord.js";
import { loadCronJobs } from "./loader.js";
import { runTask, runSkill } from "./runner-task.js";
import { runMessage } from "./runner-message.js";
import { runScript } from "./runner-script.js";
import { recordRun, getAllJobStates, type JobState } from "./state.js";
import type { CronJob } from "./types.js";
import { createLogger } from "../lib/log.js";

const log = createLogger("cron");

const tasks = new Map<string, ScheduledTask>();
const runningJobs = new Set<string>();

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_FIRST_RETRY_DELAY_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_BACKOFF_MULTIPLIER = 2;

type RetryPolicy = {
  maxAttempts: number;
  firstDelayMs: number;
  backoffMultiplier: number;
  sleep: (ms: number) => Promise<void>;
};

const sleepMs = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
};

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  firstDelayMs: DEFAULT_FIRST_RETRY_DELAY_MS,
  backoffMultiplier: DEFAULT_RETRY_BACKOFF_MULTIPLIER,
  sleep: sleepMs,
};

const NO_RETRY_POLICY: RetryPolicy = {
  ...DEFAULT_RETRY_POLICY,
  maxAttempts: 1,
};

function normalizeRetryPolicy(policy: RetryPolicy): RetryPolicy {
  return {
    ...policy,
    maxAttempts: Math.max(1, Math.floor(policy.maxAttempts)),
    firstDelayMs: Math.max(0, Math.floor(policy.firstDelayMs)),
    backoffMultiplier: Math.max(1, policy.backoffMultiplier),
  };
}

function getRetryDelayMs(policy: RetryPolicy, failedAttempt: number): number {
  return Math.floor(policy.firstDelayMs * Math.pow(policy.backoffMultiplier, failedAttempt - 1));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0 && seconds > 0) return `${minutes}m${seconds}s`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

async function runJob(job: CronJob, client: Client): Promise<void> {
  if (job.type === "task")    await runTask(job, client);
  else if (job.type === "script") await runScript(job, client);
  else if (job.type === "skill")  await runSkill(job, client);
  else if (job.type === "message") await runMessage(job, client);
}

async function dispatch(job: CronJob, client: Client, retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY): Promise<void> {
  if (runningJobs.has(job.name)) {
    const msg = `${job.name} skipped: previous run still active`;
    log.warn(msg);
    recordRun(job.name, false, 0, msg);
    return;
  }

  const policy = normalizeRetryPolicy(retryPolicy);
  runningJobs.add(job.name);
  try {
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      const startedAt = Date.now();
      try {
        if (attempt > 1) {
          log.info(`${job.name} retry attempt ${attempt}/${policy.maxAttempts}`);
        }
        await runJob(job, client);
        const durationMs = Date.now() - startedAt;
        recordRun(job.name, true, durationMs);
        return;
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        const errorMsg = err instanceof Error ? err.message : String(err);
        const willRetry = attempt < policy.maxAttempts;
        const retryDelayMs = willRetry ? getRetryDelayMs(policy, attempt) : 0;
        const recordedError = willRetry
          ? `${errorMsg} (attempt ${attempt}/${policy.maxAttempts}; retry in ${formatDuration(retryDelayMs)})`
          : `${errorMsg} (attempt ${attempt}/${policy.maxAttempts}; retries exhausted)`;

        log.error(`${job.name} failed attempt ${attempt}/${policy.maxAttempts}:`, errorMsg);
        recordRun(job.name, false, durationMs, recordedError);

        if (!willRetry) return;
        log.warn(`${job.name} retrying in ${formatDuration(retryDelayMs)} (next attempt ${attempt + 1}/${policy.maxAttempts})`);
        await policy.sleep(retryDelayMs);
      }
    }
  } finally {
    runningJobs.delete(job.name);
  }
}

export function startScheduler(client: Client): { scheduled: number; errors: Array<{ file: string; error: string }> } {
  stopScheduler(); // 防重复 startup
  const { jobs, errors } = loadCronJobs();

  for (const e of errors) log.warn(`load error: ${e.file}: ${e.error}`);

  let scheduled = 0;
  for (const job of jobs) {
    if (!job.enabled) {
      log.info(`${job.name} ⏸ disabled (skipped)`);
      continue;
    }
    try {
      const t = cron.schedule(
        job.schedule,
        () => { void dispatch(job, client); },
        { timezone: job.timezone }
      );
      tasks.set(job.name, t);
      scheduled++;
      log.info(`✓ ${job.name} (${job.type}) "${job.schedule}"${job.timezone ? ` tz=${job.timezone}` : ""}`);
    } catch (err) {
      log.error(`failed to schedule ${job.name}:`, err);
    }
  }
  log.info(`scheduler started: ${scheduled} job(s) active, ${errors.length} load error(s)`);
  return { scheduled, errors };
}

export function stopScheduler(): void {
  for (const t of tasks.values()) {
    try { void t.stop(); } catch { /* ignore */ }
  }
  tasks.clear();
}

export function listScheduled(): Array<{ name: string; state?: JobState }> {
  const states = getAllJobStates();
  return Array.from(tasks.keys()).map((name) => ({ name, state: states[name] }));
}

// 暴露给 CLI: 立刻试跑一个 job 不影响调度
export async function runJobNow(name: string, client: Client): Promise<void> {
  const { jobs } = loadCronJobs();
  const job = jobs.find((j) => j.name === name);
  if (!job) throw new Error(`job not found: ${name}`);
  await dispatch(job, client, NO_RETRY_POLICY);
}

export const __testables = { dispatch, DEFAULT_RETRY_POLICY, getRetryDelayMs };
