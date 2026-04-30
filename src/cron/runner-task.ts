import { v4 as uuid } from "uuid";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import type { Client, SendableChannels } from "discord.js";
import { config } from "../config.js";
import { createTask } from "../store/db.js";
import { executeTask, getActiveTaskCount } from "../agent/task.js";
import type { CronJobTask, CronJobSkill } from "./types.js";
import { renderTemplate } from "./template.js";
import { resolve, join } from "node:path";
import { createLogger } from "../lib/log.js";

const log = createLogger("cron");
import { homedir } from "node:os";

function resolveHome(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(2)) : resolve(p);
}

const SCRIPTS_DIR = process.env.MINICLAW_SCRIPTS_DIR ?? join(homedir(), ".miniclaw/scripts");

function buildCronPreScriptBlock(scriptName: string, stdout: string): string {
  const truncated = stdout.slice(0, 8000) + (stdout.length > 8000 ? "\n... (truncated)" : "");
  return `## 📥 上方 script (\`${scriptName}\`) 采集到的数据 (stdout)\n\n\`\`\`\n${truncated}\n\`\`\`\n\n---\n\n`;
}

function buildCronTaskPrompt(jobName: string, prependedContext: string, renderedPrompt: string): string {
  return `[cron:${jobName}]\n\n${prependedContext}${renderedPrompt}`;
}

function buildCronSkillPrompt(jobName: string, skillName: string, skillArgs?: Record<string, string | number | boolean>): string {
  const argsStr = skillArgs
    ? "\n参数:\n" + Object.entries(skillArgs).map(([k, v]) => `- ${k}: ${v}`).join("\n")
    : "";
  return `[cron:${jobName}] 请显式调用 ${skillName} skill 完成本次任务${argsStr}`;
}

export const __testables = { buildCronPreScriptBlock, buildCronTaskPrompt, buildCronSkillPrompt };

async function runPreScript(
  scriptName: string,
  args: string[],
  timeoutSec: number,
  jobName: string,
  channelId: string,
): Promise<string> {
  const scriptPath = join(SCRIPTS_DIR, scriptName);
  if (!existsSync(scriptPath)) throw new Error(`pre_script not found: ${scriptPath}`);
  const stat = statSync(scriptPath);
  if (!stat.isFile() || (stat.mode & 0o111) === 0) {
    throw new Error(`pre_script not executable: ${scriptPath} (chmod +x)`);
  }

  const env = {
    ...process.env,
    MINICLAW_CRON_NAME: jobName,
    MINICLAW_CRON_RUN_AT: new Date().toISOString(),
    MINICLAW_CHANNEL_ID: channelId,
  };

  return await new Promise<string>((resolveOk, rejectErr) => {
    const child = spawn(scriptPath, args, { cwd: SCRIPTS_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000);
    }, timeoutSec * 1000);

    child.stdout?.on("data", (c) => { stdout += c.toString(); });
    child.stderr?.on("data", (c) => { stderr += c.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      rejectErr(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (killed) rejectErr(new Error(`pre_script timeout (${timeoutSec}s)`));
      else if (code !== 0) rejectErr(new Error(`pre_script exit=${code}: ${stderr.slice(0, 500)}`));
      else resolveOk(stdout);
    });
  });
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
    log.warn(`${job.name} skipped: hit MINICLAW_MAX_CONCURRENT_TASKS=${config.maxConcurrentTasks}`);
    return;
  }
  const channel = await fetchSendableChannel(client, job.channel);
  const taskId = uuid();
  const cwd = resolveHome(job.cwd ?? config.defaultCwd);

  // 如果配了 pre_script，先跑它，把 stdout 拼到 prompt 顶部
  let prependedContext = "";
  if (job.pre_script) {
    try {
      const stdout = await runPreScript(
        job.pre_script,
        job.pre_script_args ?? [],
        job.pre_script_timeout_sec ?? 120,
        job.name,
        job.channel,
      );
      prependedContext = buildCronPreScriptBlock(job.pre_script, stdout);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await channel.send(`⏰ cron \`${job.name}\` ❌ pre_script 失败: ${msg.slice(0, 1500)}`);
      return;
    }
  }

  const renderedPrompt = renderTemplate(job.prompt, { "cron.name": job.name });
  const prompt = buildCronTaskPrompt(job.name, prependedContext, renderedPrompt);

  createTask({
    id: taskId,
    // cron 触发的 task 不属于任何 Discord thread，置空避免被 thread-continuation 误命中
    discord_thread_id: "",
    discord_user_id: "cron",
    prompt,
    cwd,
  });
  await executeTask({ taskId, prompt, cwd, channel, outputMode: "raw" });
}

export async function runSkill(job: CronJobSkill, client: Client): Promise<void> {
  if (getActiveTaskCount() >= config.maxConcurrentTasks) {
    log.warn(`${job.name} skipped: hit concurrent limit`);
    return;
  }
  const channel = await fetchSendableChannel(client, job.channel);
  const taskId = uuid();
  const cwd = resolveHome(job.cwd ?? config.defaultCwd);

  // 把 skill 调用拼成一段明确的 supervisor prompt
  const prompt = buildCronSkillPrompt(job.name, job.skill, job.skill_args);

  createTask({
    id: taskId,
    discord_thread_id: "",
    discord_user_id: "cron",
    prompt,
    cwd,
  });
  await executeTask({ taskId, prompt, cwd, channel, outputMode: "raw" });
}
