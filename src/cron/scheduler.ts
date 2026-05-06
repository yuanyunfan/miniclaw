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

async function dispatch(job: CronJob, client: Client): Promise<void> {
  if (runningJobs.has(job.name)) {
    const msg = `${job.name} skipped: previous run still active`;
    log.warn(msg);
    recordRun(job.name, false, 0, msg);
    return;
  }

  const startedAt = Date.now();
  let ok = true;
  let errorMsg: string | undefined;
  runningJobs.add(job.name);
  try {
    if (job.type === "task")    await runTask(job, client);
    else if (job.type === "script") await runScript(job, client);
    else if (job.type === "skill")  await runSkill(job, client);
    else if (job.type === "message") await runMessage(job, client);
  } catch (err) {
    ok = false;
    errorMsg = err instanceof Error ? err.message : String(err);
    log.error(`${job.name} failed:`, errorMsg);
  } finally {
    const durationMs = Date.now() - startedAt;
    recordRun(job.name, ok, durationMs, errorMsg);
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
    try { t.stop(); } catch { /* ignore */ }
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
  await dispatch(job, client);
}

export const __testables = { dispatch };
