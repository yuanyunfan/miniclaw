import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Client, SendableChannels } from "discord.js";
import { AttachmentBuilder } from "discord.js";
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

// 解析 stdout 找出可发送的附件文件路径：
// 1) JSON 行含 "png_path" / "image_path" / "media_path" 字段
// 2) 行首 `MEDIA:<absolute path>` 语法（兼容 hermes）
function extractAttachments(stdout: string): { paths: string[]; remaining: string } {
  const paths: string[] = [];
  const lines = stdout.split("\n");
  const remainingLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // MEDIA: 语法
    const mediaMatch = trimmed.match(/^MEDIA:(.+)$/);
    if (mediaMatch) {
      const path = mediaMatch[1].trim();
      if (existsSync(path) && statSync(path).size > 0) paths.push(path);
      continue;
    }

    // JSON 行，找 png_path / image_path / media_path
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        if (obj.skipped === true) {
          // 显示器休眠等：保留原样
          remainingLines.push(line);
          continue;
        }
        if (obj.error) {
          remainingLines.push(line);
          continue;
        }
        const candidate = (obj.png_path ?? obj.image_path ?? obj.media_path) as string | undefined;
        if (typeof candidate === "string" && existsSync(candidate) && statSync(candidate).size > 0) {
          paths.push(candidate);
          // JSON 行不再在文字 body 中显示
          continue;
        }
      } catch {
        // 解析失败 → 当作普通行
      }
    }

    remainingLines.push(line);
  }

  return { paths, remaining: remainingLines.join("\n").trim() };
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

  // 解析附件（PNG / image / media）
  const { paths: attachmentPaths, remaining } = success ? extractAttachments(stdout) : { paths: [], remaining: stdout };

  if (!job.capture_output && success && attachmentPaths.length === 0) {
    await postToChannel(client, job.channel, `cron \`${job.name}\` ${status} (${durationS}s)`);
    return;
  }

  const ch = await fetchChannel(client, job.channel);
  if (!ch) return;

  const files = attachmentPaths.map((p) => new AttachmentBuilder(p));

  // 仅图（无文字残余）→ 单独发图，不带啰嗦的状态行
  if (success && files.length > 0 && !remaining && !stderr) {
    await ch.send({ files });
    return;
  }

  // 有文字 / 失败 → 拼 status + body + 附件
  const errPart = stderr ? `\n--- stderr ---\n${stderr.trim()}` : "";
  const fullText = (remaining + errPart).trim();
  const truncated = fullText.length > 1700 ? fullText.slice(0, 1700) + "\n... (truncated)" : fullText;
  const body = fullText
    ? `cron \`${job.name}\` ${status} (${durationS}s)\n\`\`\`\n${truncated}\n\`\`\``
    : `cron \`${job.name}\` ${status} (${durationS}s)${files.length ? "" : " — 无输出"}`;

  await ch.send(files.length ? { content: body.slice(0, 2000), files } : { content: body.slice(0, 2000) });
}

async function fetchChannel(client: Client, channelId: string): Promise<SendableChannels | null> {
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch && "isSendable" in ch && ch.isSendable()) return ch as SendableChannels;
  } catch (err) {
    console.error(`[cron] fetch channel ${channelId} failed:`, err);
  }
  return null;
}

async function postToChannel(client: Client, channelId: string, body: string): Promise<void> {
  const ch = await fetchChannel(client, channelId);
  if (ch) {
    try { await ch.send(body.slice(0, 2000)); } catch (err) {
      console.error(`[cron] post failed for ${channelId}:`, err);
    }
  }
}
