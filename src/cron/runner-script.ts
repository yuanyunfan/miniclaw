import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Client, SendableChannels } from "discord.js";
import type { CronJobScript } from "./types.js";

const SCRIPTS_DIR_DEFAULT = join(homedir(), ".miniclaw/scripts");

function getScriptsDir(): string {
  return process.env.MINICLAW_SCRIPTS_DIR ?? SCRIPTS_DIR_DEFAULT;
}

function isExecutable(path: string): boolean {
  try {
    const s = statSync(path);
    return s.isFile() && (s.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

export async function runScript(job: CronJobScript, client: Client): Promise<void> {
  const scriptsDir = getScriptsDir();
  const scriptPath = join(scriptsDir, job.script);
  if (!existsSync(scriptPath)) {
    console.warn(`[cron] ${job.name}: script not found ${scriptPath}`);
    await postToChannel(client, job.channel, `⏰ cron \`${job.name}\` ❌ script 不存在: \`${job.script}\``);
    return;
  }
  if (!isExecutable(scriptPath)) {
    console.warn(`[cron] ${job.name}: script not executable, run: chmod +x ${scriptPath}`);
    await postToChannel(client, job.channel, `⏰ cron \`${job.name}\` ❌ script 不可执行: \`chmod +x ${scriptPath}\``);
    return;
  }

  const env = {
    ...process.env,
    MINICLAW_CRON_NAME: job.name,
    MINICLAW_CRON_RUN_AT: new Date().toISOString(),
    MINICLAW_CHANNEL_ID: job.channel,
  };
  const args = job.args ?? [];
  const timeoutMs = (job.timeout_sec ?? 300) * 1000;

  await postToChannel(client, job.channel, `⏰ cron \`${job.name}\` → script \`${job.script}\``);

  const startedAt = Date.now();
  const child = spawn(scriptPath, args, {
    cwd: scriptsDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let killed = false;

  const timer = setTimeout(() => {
    killed = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5000);
  }, timeoutMs);

  child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });

  await new Promise<void>((resolve) => {
    child.on("exit", () => { clearTimeout(timer); resolve(); });
    child.on("error", (err) => {
      stderr += `\nspawn error: ${err.message}`;
      clearTimeout(timer);
      resolve();
    });
  });

  const durationS = ((Date.now() - startedAt) / 1000).toFixed(1);
  const exitCode = child.exitCode ?? -1;
  const success = exitCode === 0 && !killed;
  const status = killed ? `🛑 timeout(${job.timeout_sec}s)` : success ? `✅ exit=0` : `❌ exit=${exitCode}`;

  if (!job.capture_output && success) {
    await postToChannel(client, job.channel, `cron \`${job.name}\` ${status} (${durationS}s)`);
    return;
  }

  // capture_output=true 或失败 → post output
  const output = (stdout + (stderr ? `\n--- stderr ---\n${stderr}` : "")).trim();
  const truncated = output.length > 1700 ? output.slice(0, 1700) + "\n... (truncated)" : output;
  const body = output
    ? `cron \`${job.name}\` ${status} (${durationS}s)\n\`\`\`\n${truncated}\n\`\`\``
    : `cron \`${job.name}\` ${status} (${durationS}s) — 无输出`;
  await postToChannel(client, job.channel, body);
}

async function postToChannel(client: Client, channelId: string, body: string): Promise<void> {
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch && "isSendable" in ch && ch.isSendable()) {
      await (ch as SendableChannels).send(body.slice(0, 2000));
    }
  } catch (err) {
    console.error(`[cron] post failed for ${channelId}:`, err);
  }
}
