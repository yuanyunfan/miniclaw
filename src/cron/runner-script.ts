import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import "../proxy.js";
import type { Client, SendableChannels } from "discord.js";
import { AttachmentBuilder } from "discord.js";
import type { CronJobRunOutcome, CronJobScript } from "./types.js";
import { createLogger } from "../lib/log.js";

const log = createLogger("cron");

const SCRIPTS_DIR_DEFAULT = join(homedir(), ".miniclaw/scripts");
const DEFAULT_TIMEOUT_SEC = 300;

class CronScriptRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronScriptRunError";
  }
}

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

function signalProcessTree(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") {
      try { child.kill(signal); } catch { /* ignore */ }
    }
  }
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0]?.slice(0, 300) ?? "";
}

function isSkippedPayload(obj: Record<string, unknown>): boolean {
  return obj.skipped === true || obj.status === "skipped";
}

function isSkippedScriptOutput(stdout: string): boolean {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return false;

  return lines.every((line) => {
    if (!line.startsWith("{") || !line.endsWith("}")) return false;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      return isSkippedPayload(obj);
    } catch {
      return false;
    }
  });
}

// 解析 stdout 找出 runner 指令：
// 1) JSON 行含 "png_path" / "image_path" / "media_path" 字段
// 2) 行首 `MEDIA:<absolute path>` 语法（兼容 hermes）
// 3) 行首 `DISCORD_MESSAGE:<absolute path>` 语法，用文件内容作为 Discord 正文
function extractScriptDirectives(stdout: string): { paths: string[]; remaining: string; messages: string[] } {
  const paths: string[] = [];
  const messages: string[] = [];
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

    // DISCORD_MESSAGE: 语法。正文走文件，避免 stdout 中的 Markdown 被外层 code block 包坏。
    const messageMatch = trimmed.match(/^DISCORD_MESSAGE:(.+)$/);
    if (messageMatch) {
      const path = messageMatch[1].trim();
      if (existsSync(path) && statSync(path).size > 0) {
        messages.push(readFileSync(path, "utf8").trim());
      }
      continue;
    }

    // JSON 行，找 png_path / image_path / media_path
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        if (isSkippedPayload(obj)) {
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

  return {
    paths,
    remaining: remainingLines.join("\n").trim(),
    messages,
  };
}

function trimDiscordContent(text: string): string {
  if (text.length <= 2000) return text;
  return text.slice(0, 1900).trimEnd() + "\n\n... (truncated)";
}

export async function runScript(job: CronJobScript, client: Client): Promise<CronJobRunOutcome> {
  const scriptsDir = getScriptsDir();
  const scriptPath = join(scriptsDir, job.script);
  if (!existsSync(scriptPath)) {
    log.warn(`${job.name}: script not found ${scriptPath}`);
    await postToChannel(client, job.channel, `⏰ cron \`${job.name}\` ❌ script 不存在: \`${job.script}\``);
    throw new CronScriptRunError(`script not found: ${job.script}`);
  }
  if (!isExecutable(scriptPath)) {
    log.warn(`${job.name}: script not executable, run: chmod +x ${scriptPath}`);
    await postToChannel(client, job.channel, `⏰ cron \`${job.name}\` ❌ script 不可执行: \`chmod +x ${scriptPath}\``);
    throw new CronScriptRunError(`script not executable: ${job.script}`);
  }

  const env = {
    ...process.env,
    MINICLAW_CRON_NAME: job.name,
    MINICLAW_CRON_RUN_AT: new Date().toISOString(),
    MINICLAW_CHANNEL_ID: job.channel,
  };
  const args = job.args ?? [];
  const timeoutSec = job.timeout_sec ?? DEFAULT_TIMEOUT_SEC;
  const timeoutMs = timeoutSec * 1000;

  const startedAt = Date.now();
  const child = spawn(scriptPath, args, {
    cwd: scriptsDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  let stdout = "";
  let stderr = "";
  let killed = false;
  let forceKillTimer: NodeJS.Timeout | undefined;

  const timer = setTimeout(() => {
    killed = true;
    signalProcessTree(child, "SIGTERM");
    forceKillTimer = setTimeout(() => signalProcessTree(child, "SIGKILL"), 5000);
  }, timeoutMs);

  child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve();
    };
    child.on("close", finish);
    child.on("error", (err) => {
      stderr += `\nspawn error: ${err.message}`;
      finish();
    });
  });

  const durationS = ((Date.now() - startedAt) / 1000).toFixed(1);
  const exitCode = child.exitCode ?? -1;
  const success = exitCode === 0 && !killed;
  const status = killed ? `🛑 timeout(${timeoutSec}s)` : success ? `✅ exit=0` : `❌ exit=${exitCode}`;
  const failureDetail = firstLine(stderr || stdout);
  const failureReason = killed
    ? `script timed out after ${timeoutSec}s`
    : success
      ? undefined
      : `script exited with code ${exitCode}${failureDetail ? `: ${failureDetail}` : ""}`;

  if (success && !stderr.trim() && isSkippedScriptOutput(stdout)) {
    log.info(`${job.name} skipped by script output`);
    return {
      status: "skipped",
      errorCategory: "script_skipped",
      errorMessage: "script output requested skip",
    };
  }

  // 解析附件（PNG / image / media）
  const { paths: attachmentPaths, remaining, messages } = success
    ? extractScriptDirectives(stdout)
    : { paths: [], remaining: stdout, messages: [] };

  if (success && job.silent_success && attachmentPaths.length === 0 && messages.length === 0 && !remaining && !stderr) {
    return { status: "success" };
  }

  if (!job.capture_output && success && attachmentPaths.length === 0) {
    await postToChannel(client, job.channel, `cron \`${job.name}\` ${status} (${durationS}s)`);
    return { status: "success" };
  }

  const ch = await fetchChannel(client, job.channel);
  if (!ch) throw new CronScriptRunError(`failed to fetch channel ${job.channel}`);

  const files = attachmentPaths.map((p) => new AttachmentBuilder(p));

  // 显式 Markdown 正文 → 原样作为 Discord content，不再套 cron status/code block。
  if (success && messages.length > 0 && !stderr) {
    for (let i = 0; i < messages.length; i++) {
      const isLast = i === messages.length - 1;
      await ch.send(isLast && files.length
        ? { content: trimDiscordContent(messages[i]), files }
        : { content: trimDiscordContent(messages[i]) });
    }
    return { status: "success" };
  }

  // 仅附件（无文字残余）→ 单独发附件，不带啰嗦的状态行
  if (success && files.length > 0 && !remaining && !stderr) {
    await ch.send({ files });
    return { status: "success" };
  }

  // 有文字 / 失败 → 拼 status + body + 附件
  const errPart = stderr ? `\n--- stderr ---\n${stderr.trim()}` : "";
  const fullText = (remaining + errPart).trim();
  const truncated = fullText.length > 1700 ? fullText.slice(0, 1700) + "\n... (truncated)" : fullText;
  const body = fullText
    ? `cron \`${job.name}\` ${status} (${durationS}s)\n\`\`\`\n${truncated}\n\`\`\``
    : `cron \`${job.name}\` ${status} (${durationS}s)${files.length ? "" : killed ? " — 超时前无输出" : " — 无输出"}`;

  try {
    await ch.send(files.length ? { content: body.slice(0, 2000), files } : { content: body.slice(0, 2000) });
  } catch (err) {
    if (failureReason) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new CronScriptRunError(`${failureReason}; failed to post result: ${msg}`);
    }
    throw err;
  }

  if (failureReason) throw new CronScriptRunError(failureReason);
  return { status: "success" };
}

async function fetchChannel(client: Client, channelId: string): Promise<SendableChannels | null> {
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch && "isSendable" in ch && ch.isSendable()) return ch as SendableChannels;
  } catch (err) {
    log.error(`fetch channel ${channelId} failed:`, err);
  }
  return null;
}

async function postToChannel(client: Client, channelId: string, body: string): Promise<void> {
  const ch = await fetchChannel(client, channelId);
  if (ch) {
    try { await ch.send(body.slice(0, 2000)); } catch (err) {
      log.error(`post failed for ${channelId}:`, err);
    }
  }
}
