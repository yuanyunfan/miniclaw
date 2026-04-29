import { v4 as uuid } from "uuid";
import type { Client, SendableChannels } from "discord.js";
import { config } from "../config.js";
import { createTask } from "../store/db.js";
import { executeTask, getActiveTaskCount } from "../agent/task.js";
import type { CronJobTask, CronJobSkill } from "./types.js";
import { renderTemplate } from "./template.js";
import { resolve } from "node:path";
import { homedir } from "node:os";

function resolveHome(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(2)) : resolve(p);
}

async function fetchSendableChannel(client: Client, channelId: string): Promise<SendableChannels> {
  const ch = await client.channels.fetch(channelId);
  if (!ch || !("isSendable" in ch) || !ch.isSendable()) {
    throw new Error(`channel ${channelId} not sendable or not found`);
  }
  return ch as SendableChannels;
}

export async function runTask(job: CronJobTask, client: Client): Promise<void> {
  if (getActiveTaskCount() >= config.maxConcurrentTasks) {
    console.warn(`[cron] ${job.name} skipped: hit MINICLAW_MAX_CONCURRENT_TASKS=${config.maxConcurrentTasks}`);
    return;
  }
  const channel = await fetchSendableChannel(client, job.channel);
  const taskId = uuid();
  const cwd = resolveHome(job.cwd ?? config.defaultCwd);
  const prompt = `[cron:${job.name}] ${renderTemplate(job.prompt, { "cron.name": job.name })}`;

  createTask({
    id: taskId,
    discord_thread_id: channel.id,
    discord_user_id: "cron",
    prompt,
    cwd,
  });
  await executeTask({ taskId, prompt, cwd, channel, outputMode: "raw" });
}

export async function runSkill(job: CronJobSkill, client: Client): Promise<void> {
  if (getActiveTaskCount() >= config.maxConcurrentTasks) {
    console.warn(`[cron] ${job.name} skipped: hit concurrent limit`);
    return;
  }
  const channel = await fetchSendableChannel(client, job.channel);
  const taskId = uuid();
  const cwd = resolveHome(job.cwd ?? config.defaultCwd);

  // 把 skill 调用拼成一段明确的 supervisor prompt
  const argsStr = job.skill_args
    ? "\n参数:\n" + Object.entries(job.skill_args).map(([k, v]) => `- ${k}: ${v}`).join("\n")
    : "";
  const prompt = `[cron:${job.name}] 请显式调用 ${job.skill} skill 完成本次任务${argsStr}`;

  createTask({
    id: taskId,
    discord_thread_id: channel.id,
    discord_user_id: "cron",
    prompt,
    cwd,
  });
  await executeTask({ taskId, prompt, cwd, channel, outputMode: "raw" });
}
