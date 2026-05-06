import { EmbedBuilder } from "discord.js";
import { displaySessionId } from "../agent/session.js";

function ellipsis(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 3) + "..." : text;
}

export function taskStartEmbed(taskId: string, prompt: string, cwd: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("🔵 任务执行中")
    .setDescription(ellipsis(prompt, 4096))
    .addFields(
      { name: "任务 ID", value: taskId.slice(0, 8), inline: true },
      { name: "工作目录", value: cwd, inline: true }
    )
    .setTimestamp()
    .setColor(0x3498db);
}

export function taskCompleteEmbed(params: {
  taskId: string;
  result: string;
  durationMs: number;
  costUsd: number;
  turns: number;
  sessionId: string;
  tokensSummary?: string;
}): EmbedBuilder {
  const duration = (params.durationMs / 1000).toFixed(1);
  const fields = [
    { name: "耗时", value: `${duration}s`, inline: true },
    { name: "费用", value: `$${params.costUsd.toFixed(4)}`, inline: true },
    { name: "轮次", value: String(params.turns), inline: true },
    { name: "Session", value: displaySessionId(params.sessionId), inline: true },
  ];
  if (params.tokensSummary) {
    fields.push({ name: "Tokens", value: params.tokensSummary, inline: false });
  }
  return new EmbedBuilder()
    .setTitle("✅ 任务完成")
    .setDescription(ellipsis(params.result, 4096))
    .addFields(...fields)
    .setTimestamp()
    .setColor(0x2ecc71);
}

export function taskErrorEmbed(taskId: string, error: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("❌ 任务失败")
    .setDescription(ellipsis(error, 4096))
    .addFields({ name: "任务 ID", value: taskId.slice(0, 8), inline: true })
    .setTimestamp()
    .setColor(0xe74c3c);
}

interface StatusTask {
  id: string;
  prompt: string;
  status: string;
  discord_thread_id?: string | null;
}

function fmtTaskLine(t: StatusTask, withResume = false): string {
  const id = t.id.slice(0, 8);
  const promptSnippet = t.prompt.replace(/\s+/g, " ").slice(0, 60);
  const threadLink = t.discord_thread_id ? ` <#${t.discord_thread_id}>` : "";
  const resumeHint = withResume ? `\n  ↳ \`/resume task_id:${id} followup:"继续"\`` : "";
  return `**${id}**${threadLink} ${promptSnippet}${resumeHint}`;
}

export function statusOverviewEmbed(params: {
  active: StatusTask[];
  interrupted: StatusTask[];
  recent: StatusTask[];
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("📋 任务总览")
    .setColor(0x9b59b6)
    .setTimestamp();

  const activeText = params.active.length
    ? params.active.map((t) => fmtTaskLine(t)).join("\n")
    : "(无活跃任务)";
  embed.addFields({ name: `🟢 活跃 (${params.active.length})`, value: ellipsis(activeText, 1024) });

  const interruptedText = params.interrupted.length
    ? params.interrupted.map((t) => fmtTaskLine(t, true)).join("\n")
    : "(无中断任务)";
  embed.addFields({ name: `⚠️ 中断待恢复 (${params.interrupted.length})`, value: ellipsis(interruptedText, 1024) });

  const recentText = params.recent.length
    ? params.recent.map((t) => `**${t.id.slice(0, 8)}** [${t.status}] ${t.prompt.replace(/\s+/g, " ").slice(0, 60)}`).join("\n")
    : "(无最近任务)";
  embed.addFields({ name: `📜 最近完成 (${params.recent.length})`, value: ellipsis(recentText, 1024) });

  return embed;
}

function fmtUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function healthEmbed(params: {
  provider: string;
  model: string;
  uptimeSec: number;
  rssMb: number;
  heapUsedMb: number;
  activeTasks: number;
  maxConcurrentTasks: number;
  interruptedTasks: number;
  scheduledJobs: number;
  cronErrors: number;
  dbPath: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("🩺 MiniClaw Health")
    .setColor(params.cronErrors > 0 ? 0xf39c12 : 0x2ecc71)
    .addFields(
      { name: "Provider", value: `${params.provider} / ${params.model}`, inline: true },
      { name: "Uptime", value: fmtUptime(params.uptimeSec), inline: true },
      { name: "Memory", value: `rss ${params.rssMb.toFixed(1)}MB · heap ${params.heapUsedMb.toFixed(1)}MB`, inline: false },
      { name: "Tasks", value: `${params.activeTasks}/${params.maxConcurrentTasks} active · ${params.interruptedTasks} interrupted`, inline: true },
      { name: "Cron", value: `${params.scheduledJobs} scheduled · ${params.cronErrors} recent error`, inline: true },
      { name: "DB", value: params.dbPath, inline: false },
    )
    .setTimestamp();
}

export const __testables = { fmtUptime };
