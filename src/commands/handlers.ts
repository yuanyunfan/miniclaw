import {
  ChatInputCommandInteraction,
  ChannelType,
} from "discord.js";
import { v4 as uuid } from "uuid";
import { resolve } from "path";
import { homedir } from "os";
import { config } from "../config.js";
import { createTask, getActiveTasks, getRecentTasks, getTask, updateTask } from "../store/db.js";
import { executeTask, getActiveTaskCount, cancelTask } from "../agent/task.js";
import { taskStartEmbed, statusEmbed, taskErrorEmbed } from "../discord/formatter.js";

function resolveHome(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(2)) : resolve(p);
}

function isAllowed(userId: string): boolean {
  return userId === config.allowedUserId;
}

export async function handleTask(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return;
  }

  if (getActiveTaskCount() >= config.maxConcurrentTasks) {
    await interaction.reply({
      content: `⚠️ 已达并发上限 (${config.maxConcurrentTasks})，请等待现有任务完成`,
      ephemeral: true,
    });
    return;
  }

  const description = interaction.options.getString("description", true);
  const cwdRaw = interaction.options.getString("cwd") ?? config.defaultCwd;
  const cwd = resolveHome(cwdRaw);
  const taskId = uuid();

  await interaction.deferReply();

  const parentChannel = interaction.channel;
  if (!parentChannel || !("threads" in parentChannel)) {
    await interaction.editReply("❌ 无法在此频道创建线程");
    return;
  }

  const thread = await parentChannel.threads.create({
    name: `🤖 ${description.slice(0, 90)}`,
    autoArchiveDuration: 1440,
  });

  createTask({
    id: taskId,
    discord_thread_id: thread.id,
    discord_user_id: interaction.user.id,
    prompt: description,
    cwd,
  });

  await interaction.editReply(`✅ 任务已创建，请查看线程 <#${thread.id}>`);
  await thread.send({ embeds: [taskStartEmbed(taskId, description, cwd)] });

  if (!thread.isTextBased() || thread.type !== ChannelType.PublicThread) {
    await interaction.editReply("❌ 线程创建异常");
    return;
  }

  executeTask({
    taskId,
    prompt: description,
    cwd,
    channel: thread,
  }).catch((err) => {
    console.error(`[MiniClaw] Task ${taskId} error:`, err);
  });
}

export async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return;
  }

  const active = getActiveTasks();
  const recent = getRecentTasks(5);
  const tasks = active.length > 0 ? active : recent;

  await interaction.reply({
    embeds: [statusEmbed(tasks)],
    ephemeral: true,
  });
}

export async function handleCancel(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return;
  }

  const taskIdPrefix = interaction.options.getString("task_id", true);
  const active = getActiveTasks();
  const match = active.find((t) => t.id.startsWith(taskIdPrefix));

  if (!match) {
    await interaction.reply({ content: `❌ 找不到活跃任务 \`${taskIdPrefix}\``, ephemeral: true });
    return;
  }

  const cancelled = cancelTask(match.id);
  if (cancelled) {
    updateTask(match.id, { status: "cancelled", completed_at: new Date().toISOString() });
    await interaction.reply(`🛑 已取消任务 \`${match.id.slice(0, 8)}\``);
  } else {
    await interaction.reply({ content: "❌ 取消失败（任务可能已完成）", ephemeral: true });
  }
}

export async function handleResume(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return;
  }

  if (getActiveTaskCount() >= config.maxConcurrentTasks) {
    await interaction.reply({
      content: `⚠️ 已达并发上限 (${config.maxConcurrentTasks})`,
      ephemeral: true,
    });
    return;
  }

  const taskIdPrefix = interaction.options.getString("task_id", true);
  const followup = interaction.options.getString("followup", true);

  const allTasks = getRecentTasks(100);
  const match = allTasks.find((t) => t.id.startsWith(taskIdPrefix));

  if (!match || !match.session_id) {
    await interaction.reply({
      content: `❌ 找不到可恢复的任务 \`${taskIdPrefix}\``,
      ephemeral: true,
    });
    return;
  }

  const newTaskId = uuid();
  const cwd = match.cwd ?? config.defaultCwd;

  await interaction.deferReply();

  const parentChannel = interaction.channel;
  if (!parentChannel || !("threads" in parentChannel)) {
    await interaction.editReply("❌ 无法在此频道创建线程");
    return;
  }

  const thread = await parentChannel.threads.create({
    name: `🔄 ${followup.slice(0, 90)}`,
    autoArchiveDuration: 1440,
  });

  createTask({
    id: newTaskId,
    discord_thread_id: thread.id,
    discord_user_id: interaction.user.id,
    prompt: followup,
    cwd,
  });

  await interaction.editReply(`✅ 恢复任务，请查看线程 <#${thread.id}>`);
  await thread.send({
    embeds: [taskStartEmbed(newTaskId, `[恢复] ${followup}`, cwd)],
  });

  if (!thread.isTextBased() || thread.type !== ChannelType.PublicThread) {
    await interaction.editReply("❌ 线程创建异常");
    return;
  }

  executeTask({
    taskId: newTaskId,
    prompt: followup,
    cwd,
    channel: thread,
    resumeSessionId: match.session_id,
  }).catch((err) => {
    console.error(`[MiniClaw] Resume task ${newTaskId} error:`, err);
  });
}
