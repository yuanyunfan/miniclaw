import {
  ChatInputCommandInteraction,
  ChannelType,
  EmbedBuilder,
  type Attachment,
} from "discord.js";
import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import { createTask, getActiveTasks, getInterruptedTasks, getRecentTasks, getTask, updateTask } from "../store/db.js";
import { executeTask, getActiveTaskCount, cancelTask, listActiveTaskIds } from "../agent/task.js";
import { taskStartEmbed, statusOverviewEmbed, taskErrorEmbed, healthEmbed } from "../discord/formatter.js";
import { addMemory, deleteMemory, getAllMemories, getMemoriesByType } from "../store/memory.js";
import { createLogger } from "../lib/log.js";
import { assertProviderSession } from "../agent/session.js";
import { listScheduled } from "../cron/scheduler.js";
import { formatAgentRuntimeSummary } from "../agent/runtime-config.js";
import { createAndRunDiscordTask, taskCapacityError } from "../discord/task-intake.js";
import { resolveTaskCwd } from "../routing/cwd.js";

const log = createLogger("handlers");

function isAllowed(userId: string): boolean {
  return userId === config.allowedUserId;
}

export async function handleTask(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return;
  }

  const capacity = taskCapacityError();
  if (capacity) {
    await interaction.reply({
      content: capacity,
      ephemeral: true,
    });
    return;
  }

  const description = interaction.options.getString("description", true);
  const cwd = resolveTaskCwd(interaction.channelId, interaction.options.getString("cwd"));

  const slotAtts: Attachment[] = [];
  for (const slot of ["file1", "file2", "file3"]) {
    const a = interaction.options.getAttachment(slot);
    if (a) slotAtts.push(a);
  }

  await interaction.deferReply();

  const parentChannel = interaction.channel;
  if (!parentChannel || !("threads" in parentChannel)) {
    await interaction.editReply("❌ 无法在此频道创建线程");
    return;
  }

  await createAndRunDiscordTask({
    prompt: description,
    cwd,
    userId: interaction.user.id,
    attachments: slotAtts,
    createThread: (name) => parentChannel.threads.create({
      name,
      autoArchiveDuration: 1440,
    }),
    onCreated: async (result) => {
      await interaction.editReply(`✅ 任务已创建，请查看线程 <#${result.threadId}>`);
    },
  });
}

export async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return;
  }

  const activeIds = new Set(listActiveTaskIds());
  const dbActive = getActiveTasks();
  // In-flight: rows with status='running' AND a live in-process AbortController.
  const active = dbActive.filter((t) => activeIds.has(t.id));
  const interrupted = getInterruptedTasks(5);
  const recent = getRecentTasks(20)
    .filter((t) => ["completed", "failed", "cancelled"].includes(t.status))
    .slice(0, 5);

  await interaction.reply({
    embeds: [statusOverviewEmbed({ active, interrupted, recent })],
    ephemeral: true,
  });
}

export async function handleHealth(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return;
  }

  const mem = process.memoryUsage();
  const scheduled = listScheduled();
  const cronErrors = scheduled.filter((j) => j.state?.last_status === "error").length;
  const interrupted = getInterruptedTasks(20);

  await interaction.reply({
    embeds: [healthEmbed({
      provider: config.agentProvider,
      model: config.model,
      uptimeSec: process.uptime(),
      rssMb: mem.rss / 1024 / 1024,
      heapUsedMb: mem.heapUsed / 1024 / 1024,
      activeTasks: getActiveTaskCount(),
      maxConcurrentTasks: config.maxConcurrentTasks,
      interruptedTasks: interrupted.length,
      scheduledJobs: scheduled.length,
      cronErrors,
      dbPath: config.dbPath,
    })],
    ephemeral: true,
  });
}

export async function handleAgentConfig(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return;
  }

  await interaction.reply({
    content: formatAgentRuntimeSummary(),
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

  try {
    assertProviderSession(match.session_id, config.agentProvider);
  } catch (err) {
    await interaction.reply({
      content: `❌ ${err instanceof Error ? err.message : String(err)}`,
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
  const statusMessage = await thread.send({
    embeds: [taskStartEmbed(newTaskId, `[恢复] ${followup}`, cwd, {
      provider: config.agentProvider,
      model: config.model,
    })],
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
    statusMessage,
  }).catch((err) => {
    log.error(`Resume task ${newTaskId} error:`, err);
  });
}

const TYPE_LABELS: Record<string, string> = {
  user: "👤 用户信息",
  feedback: "💬 反馈偏好",
  project: "📁 项目信息",
  reference: "🔗 参考资料",
};

export async function handleRemember(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return;
  }

  const content = interaction.options.getString("content", true);
  const type = interaction.options.getString("type") ?? "user";
  const name = interaction.options.getString("name") ?? content.slice(0, 30).replace(/\n/g, " ");

  const row = addMemory(type, name, content);
  await interaction.reply(`✅ 已记住: **${row.name}** (ID: ${row.id}, 类型: ${TYPE_LABELS[row.type] ?? row.type})`);
}

export async function handleForget(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return;
  }

  const id = interaction.options.getString("id", true);
  const deleted = deleteMemory(id);

  if (deleted) {
    await interaction.reply(`🗑️ 已删除记忆 \`${id}\``);
  } else {
    await interaction.reply({ content: `❌ 找不到记忆 \`${id}\``, ephemeral: true });
  }
}

export async function handleMemories(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return;
  }

  const type = interaction.options.getString("type");
  const memories = type ? getMemoriesByType(type) : getAllMemories();

  if (!memories.length) {
    await interaction.reply({ content: "📭 暂无记忆", ephemeral: true });
    return;
  }

  const grouped = new Map<string, typeof memories>();
  for (const m of memories) {
    const list = grouped.get(m.type) ?? [];
    list.push(m);
    grouped.set(m.type, list);
  }

  const embed = new EmbedBuilder()
    .setTitle("🧠 记忆列表")
    .setColor(0x3498db)
    .setTimestamp();

  for (const [t, rows] of grouped) {
    const label = TYPE_LABELS[t] ?? t;
    const lines = rows.map((r) => `**#${r.id}** ${r.name}\n${r.content.slice(0, 80)}${r.content.length > 80 ? "..." : ""}`);
    const value = lines.join("\n\n").slice(0, 1024);
    embed.addFields({ name: label, value: value || "(空)" });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
