import { EmbedBuilder } from "discord.js";

export function taskStartEmbed(taskId: string, prompt: string, cwd: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("🔵 任务执行中")
    .setDescription(prompt.slice(0, 4096))
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
}): EmbedBuilder {
  const duration = (params.durationMs / 1000).toFixed(1);
  return new EmbedBuilder()
    .setTitle("✅ 任务完成")
    .setDescription(params.result.slice(0, 4096))
    .addFields(
      { name: "耗时", value: `${duration}s`, inline: true },
      { name: "费用", value: `$${params.costUsd.toFixed(4)}`, inline: true },
      { name: "轮次", value: String(params.turns), inline: true },
      { name: "Session", value: params.sessionId.slice(0, 8), inline: true }
    )
    .setTimestamp()
    .setColor(0x2ecc71);
}

export function taskErrorEmbed(taskId: string, error: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("❌ 任务失败")
    .setDescription(error.slice(0, 4096))
    .addFields({ name: "任务 ID", value: taskId.slice(0, 8), inline: true })
    .setTimestamp()
    .setColor(0xe74c3c);
}

export function statusEmbed(
  tasks: Array<{ id: string; prompt: string; status: string; created_at: string }>
): EmbedBuilder {
  const lines = tasks.map(
    (t) => `**${t.id.slice(0, 8)}** [${t.status}] ${t.prompt.slice(0, 60)}`
  );
  return new EmbedBuilder()
    .setTitle("📋 任务列表")
    .setDescription(lines.join("\n").slice(0, 4096) || "无任务")
    .setTimestamp()
    .setColor(0x9b59b6);
}
