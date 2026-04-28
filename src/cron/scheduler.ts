import cron, { type ScheduledTask } from "node-cron";
import type { Client } from "discord.js";
import { loadCronJobs } from "./loader.js";
import { runTask, runSkill } from "./runner-task.js";
import { runMessage } from "./runner-message.js";
import { runScript } from "./runner-script.js";
import type { CronJob } from "./types.js";

const tasks = new Map<string, ScheduledTask>();
const lastRun = new Map<string, { at: string; ok: boolean; error?: string }>();

async function dispatch(job: CronJob, client: Client): Promise<void> {
  const startedAt = new Date().toISOString();
  try {
    if (job.type === "task")    await runTask(job, client);
    else if (job.type === "script") await runScript(job, client);
    else if (job.type === "skill")  await runSkill(job, client);
    else if (job.type === "message") await runMessage(job, client);
    lastRun.set(job.name, { at: startedAt, ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cron] ${job.name} failed:`, msg);
    lastRun.set(job.name, { at: startedAt, ok: false, error: msg });
  }
}

export function startScheduler(client: Client): { scheduled: number; errors: Array<{ file: string; error: string }> } {
  stopScheduler(); // 防重复 startup
  const { jobs, errors } = loadCronJobs();

  for (const e of errors) console.warn(`[cron] load error: ${e.file}: ${e.error}`);

  let scheduled = 0;
  for (const job of jobs) {
    if (!job.enabled) {
      console.log(`[cron] ${job.name} ⏸ disabled (skipped)`);
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
      console.log(`[cron] ✓ ${job.name} (${job.type}) "${job.schedule}"${job.timezone ? ` tz=${job.timezone}` : ""}`);
    } catch (err) {
      console.error(`[cron] failed to schedule ${job.name}:`, err);
    }
  }
  console.log(`[cron] scheduler started: ${scheduled} job(s) active, ${errors.length} load error(s)`);
  return { scheduled, errors };
}

export function stopScheduler(): void {
  for (const t of tasks.values()) {
    try { t.stop(); } catch { /* ignore */ }
  }
  tasks.clear();
}

export function listScheduled(): Array<{ name: string; lastRun?: { at: string; ok: boolean; error?: string } }> {
  return Array.from(tasks.keys()).map((name) => ({ name, lastRun: lastRun.get(name) }));
}

// 暴露给 CLI: 立刻试跑一个 job 不影响调度
export async function runJobNow(name: string, client: Client): Promise<void> {
  const { jobs } = loadCronJobs();
  const job = jobs.find((j) => j.name === name);
  if (!job) throw new Error(`job not found: ${name}`);
  await dispatch(job, client);
}
