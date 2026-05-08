import cron, { type ScheduledTask } from "node-cron";
import type { Client } from "discord.js";
import { randomUUID } from "node:crypto";
import { loadCronJobs } from "./loader.js";
import { runTask, runSkill } from "./runner-task.js";
import { runMessage } from "./runner-message.js";
import { runScript } from "./runner-script.js";
import { recordRun, getAllJobStates, updateJobState, type JobState } from "./state.js";
import type { CronJob } from "./types.js";
import {
  sendOrUpdateCronFailureAlert,
  updateCronRecoveredAlert,
  type CronFailureAlertRef,
} from "./failure-notifier.js";
import { createLogger } from "../lib/log.js";

const log = createLogger("cron");

const tasks = new Map<string, ScheduledTask>();
const runningJobs = new Set<string>();
const retryWaiters = new Map<string, { runId: string; wake: () => void }>();

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_FIRST_RETRY_DELAY_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_BACKOFF_MULTIPLIER = 2;

type RetryPolicy = {
  maxAttempts: number;
  firstDelayMs: number;
  backoffMultiplier: number;
  sleep: (ms: number) => Promise<void>;
};

type DispatchOptions = {
  notifyFailures?: boolean;
  failureAlert?: CronFailureAlertRef;
};

type CronRetryBeforeRun = (pending: { status: "woke" | "started"; jobName: string }) => Promise<void>;

type CronRetryRequestOptions = {
  beforeRun?: CronRetryBeforeRun;
  failureAlert?: CronFailureAlertRef;
};

export type CronRetryRequestResult =
  | { ok: true; status: "woke" | "started"; jobName: string }
  | { ok: false; reason: "not_found" | "disabled" | "already_running"; message: string; jobName?: string };

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

function alertMetadata(ref: CronFailureAlertRef | undefined): Partial<JobState> {
  return {
    ...(ref?.messageId ? { failure_alert_message_id: ref.messageId } : {}),
    ...(ref?.channelId ? { failure_alert_channel_id: ref.channelId } : {}),
  };
}

async function waitForRetryDelay(
  jobName: string,
  runId: string,
  retryDelayMs: number,
  sleep: (ms: number) => Promise<void>
): Promise<void> {
  let wake!: () => void;
  const wakePromise = new Promise<void>((resolve) => {
    wake = resolve;
  });
  retryWaiters.set(jobName, { runId, wake });
  try {
    await Promise.race([sleep(retryDelayMs), wakePromise]);
  } finally {
    const current = retryWaiters.get(jobName);
    if (current?.runId === runId) retryWaiters.delete(jobName);
  }
}

async function runJob(job: CronJob, client: Client): Promise<void> {
  if (job.type === "task")    await runTask(job, client);
  else if (job.type === "script") await runScript(job, client);
  else if (job.type === "skill")  await runSkill(job, client);
  else if (job.type === "message") await runMessage(job, client);
}

async function dispatch(
  job: CronJob,
  client: Client,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
  options: DispatchOptions = {}
): Promise<void> {
  if (runningJobs.has(job.name)) {
    const msg = `${job.name} skipped: previous run still active`;
    log.warn(msg);
    recordRun(job.name, false, 0, msg);
    return;
  }

  const policy = normalizeRetryPolicy(retryPolicy);
  const notifyFailures = options.notifyFailures ?? false;
  const failureRunId = randomUUID();
  let failureAlert: CronFailureAlertRef | undefined = options.failureAlert;
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
        recordRun(job.name, true, durationMs, undefined, {
          last_attempt: attempt,
          max_attempts: policy.maxAttempts,
        });
        if (failureAlert) {
          await updateCronRecoveredAlert(job, {
            runId: failureRunId,
            attempt,
            maxAttempts: policy.maxAttempts,
            durationMs,
            recoveredAt: new Date(),
          }, failureAlert);
        }
        return;
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        const errorMsg = err instanceof Error ? err.message : String(err);
        const willRetry = attempt < policy.maxAttempts;
        const retryDelayMs = willRetry ? getRetryDelayMs(policy, attempt) : 0;
        const nextRetryAt = willRetry ? new Date(Date.now() + retryDelayMs) : undefined;
        const recordedError = willRetry
          ? `${errorMsg} (attempt ${attempt}/${policy.maxAttempts}; retry in ${formatDuration(retryDelayMs)})`
          : `${errorMsg} (attempt ${attempt}/${policy.maxAttempts}; retries exhausted)`;

        log.error(`${job.name} failed attempt ${attempt}/${policy.maxAttempts}:`, errorMsg);
        recordRun(job.name, false, durationMs, recordedError, {
          last_attempt: attempt,
          max_attempts: policy.maxAttempts,
          failure_run_id: failureRunId,
          ...(nextRetryAt ? { next_retry_at: nextRetryAt.toISOString() } : {}),
          ...alertMetadata(failureAlert),
        });

        if (notifyFailures) {
          try {
            failureAlert = await sendOrUpdateCronFailureAlert(client, job, {
              runId: failureRunId,
              attempt,
              maxAttempts: policy.maxAttempts,
              durationMs,
              error: recordedError,
              failedAt: new Date(),
              ...(nextRetryAt ? { nextRetryAt } : {}),
            }, failureAlert);
            if (failureAlert) {
              updateJobState(job.name, alertMetadata(failureAlert));
            }
          } catch (notifyErr) {
            log.error(`${job.name} failed to send cron failure alert:`, notifyErr);
          }
        }

        if (!willRetry) return;
        log.warn(`${job.name} retrying in ${formatDuration(retryDelayMs)} (next attempt ${attempt + 1}/${policy.maxAttempts})`);
        await waitForRetryDelay(job.name, failureRunId, retryDelayMs, policy.sleep);
        updateJobState(job.name, {}, ["next_retry_at"]);
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
        () => { void dispatch(job, client, DEFAULT_RETRY_POLICY, { notifyFailures: true }); },
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
  await dispatch(job, client, NO_RETRY_POLICY, { notifyFailures: false });
}

export async function requestCronRetryNow(
  runId: string,
  client: Client,
  options: CronRetryRequestOptions = {}
): Promise<CronRetryRequestResult> {
  const entry = Object.entries(getAllJobStates()).find(([, state]) => (
    state.last_status === "error" && state.failure_run_id === runId
  ));
  if (!entry) {
    return {
      ok: false,
      reason: "not_found",
      message: "这个失败记录已经过期，或定时任务已经恢复成功。",
    };
  }

  const [jobName] = entry;
  const waiter = retryWaiters.get(jobName);
  if (waiter?.runId === runId) {
    await options.beforeRun?.({ status: "woke", jobName });
    waiter.wake();
    return { ok: true, status: "woke", jobName };
  }

  if (runningJobs.has(jobName)) {
    return {
      ok: false,
      reason: "already_running",
      jobName,
      message: "该定时任务正在执行中，请等待当前执行完成。",
    };
  }

  const { jobs } = loadCronJobs();
  const job = jobs.find((j) => j.name === jobName);
  if (!job) {
    return {
      ok: false,
      reason: "not_found",
      jobName,
      message: `找不到定时任务配置: ${jobName}`,
    };
  }
  if (!job.enabled) {
    return {
      ok: false,
      reason: "disabled",
      jobName,
      message: `定时任务已禁用: ${jobName}`,
    };
  }

  await options.beforeRun?.({ status: "started", jobName });
  void dispatch(job, client, NO_RETRY_POLICY, {
    notifyFailures: true,
    failureAlert: options.failureAlert,
  }).catch((err) => {
    log.error(`${jobName} immediate retry failed unexpectedly:`, err);
  });
  return { ok: true, status: "started", jobName };
}

export const __testables = { dispatch, DEFAULT_RETRY_POLICY, getRetryDelayMs, waitForRetryDelay };
