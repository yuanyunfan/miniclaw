import "../proxy.js";
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
import { TaskReporter } from "../agent/task-reporter.js";
import { taskStartEmbed, statusOverviewEmbed, taskErrorEmbed, healthEmbed } from "../discord/formatter.js";
import { addMemory, deleteMemory, getAllMemories, getMemoriesByType } from "../store/memory.js";
import { createLogger } from "../lib/log.js";
import { assertProviderSession } from "../agent/session.js";
import { listScheduled } from "../cron/scheduler.js";
import { formatAgentRuntimeSummary } from "../agent/runtime-config.js";
import { createAndRunDiscordTask, formatTaskCompletionNotice, taskCapacityError } from "../discord/task-intake.js";
import { buildTaskSourceFromInteraction, withTaskThreadMetadata } from "../discord/task-context.js";
import { resolveTaskCwd } from "../routing/cwd.js";
import { buildTaskPromptWithContext } from "../routing/task-context.js";
import { formatDoctorReport, runDoctor, type DoctorMode } from "../ops/doctor.js";
import { resolveDoctorSummaryChannel } from "../ops/doctor-discord.js";
import { evaluateRepairPolicy } from "../ops/doctor-repair.js";
import { formatDoctorShipResult, runDoctorShip } from "../ops/doctor-ship.js";
import {
  appendIncidentEvent,
  countIncidents,
  countOpenIncidents,
  getIncident,
  getLatestRepairRunForIncident,
  listIncidentEvents,
  listIncidentsByIdPrefix,
  listIncidents,
  listRepairRunsForIncident,
  markIncidentStatus,
  type IncidentListFilters,
  type IncidentRow,
  type IncidentSeverity,
  type IncidentStatus,
} from "../store/incidents.js";
import {
  formatIncidentDetail,
  formatIncidentResolution,
  type IncidentTaskTraceContext,
} from "./incident-detail.js";
import { buildIncidentListReply, normalizeIncidentFilterValue, normalizeIncidentListLimit } from "./incidents.js";
import { buildTaskLogReply, formatTaskTraceError } from "./task-log.js";
import { buildCronRunDetailReply, buildCronRunsReply } from "./cron-runs.js";
import { buildTaskTraceModel, resolveTaskForTrace } from "../store/task-trace-export.js";
import { listCronRunsForIncident, type CronRunRow } from "../store/cron-runs.js";

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
    taskContext: {
      source: buildTaskSourceFromInteraction(interaction, "slash_command", { cwd }),
    },
    createThread: (name) => parentChannel.threads.create({
      name,
      autoArchiveDuration: 1440,
    }),
    onCreated: async (result) => {
      await interaction.editReply(`✅ 任务已创建，请查看线程 <#${result.threadId}>`);
    },
    onCompleted: async (result, taskResult) => {
      if ("send" in parentChannel) {
        await parentChannel.send(formatTaskCompletionNotice(result, taskResult));
      }
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

export async function handleTaskLog(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return;
  }

  const taskIdPrefix = interaction.options.getString("id", true);
  await interaction.deferReply({ ephemeral: true });

  const resolved = resolveTaskForTrace(taskIdPrefix);
  if (!resolved.ok) {
    await interaction.editReply(formatTaskTraceError(resolved.error));
    return;
  }

  const model = buildTaskTraceModel(resolved.value.id, { maxEvents: 300 });
  if (!model.ok) {
    await interaction.editReply(formatTaskTraceError(model.error));
    return;
  }

  await interaction.editReply(buildTaskLogReply(model.value));
}

export async function handleCronRuns(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return;
  }

  await interaction.reply({
    content: buildCronRunsReply({
      jobName: interaction.options.getString("job"),
      limit: interaction.options.getInteger("limit"),
    }),
    ephemeral: true,
  });
}

export async function handleCronRun(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return;
  }

  await interaction.reply({
    content: buildCronRunDetailReply(interaction.options.getString("id", true)),
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
      provider: config.runtime.defaultAgent,
      model: config.model,
      uptimeSec: process.uptime(),
      rssMb: mem.rss / 1024 / 1024,
      heapUsedMb: mem.heapUsed / 1024 / 1024,
      activeTasks: getActiveTaskCount(),
      maxConcurrentTasks: config.maxConcurrentTasks,
      interruptedTasks: interrupted.length,
      scheduledJobs: scheduled.length,
      cronErrors,
      openIncidents: countOpenIncidents(),
      dbPath: config.dbPath,
    })],
    ephemeral: true,
  });
}

export async function handleIncidents(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return;
  }

  const filters: IncidentListFilters = {
    status: normalizeIncidentFilterValue(interaction.options.getString("status")) as IncidentStatus | undefined,
    type: normalizeIncidentFilterValue(interaction.options.getString("type")),
    severity: normalizeIncidentFilterValue(interaction.options.getString("severity")) as IncidentSeverity | undefined,
    category: normalizeIncidentFilterValue(interaction.options.getString("category")),
    provider: normalizeIncidentFilterValue(interaction.options.getString("provider")),
    route: normalizeIncidentFilterValue(interaction.options.getString("route")),
    repairStatus: normalizeIncidentFilterValue(interaction.options.getString("repair_status")),
  };
  const limit = normalizeIncidentListLimit(interaction.options.getInteger("limit"));
  const incidents = listIncidents(filters, limit);
  const total = countIncidents(filters);
  const repairStatuses = new Map(
    incidents.map((incident) => [incident.id, getLatestRepairRunForIncident(incident.id)?.status ?? "none"])
  );

  await interaction.reply({
    content: buildIncidentListReply({ incidents, total, filters, repairStatuses }),
    ephemeral: true,
  });
}

function resolveIncident(input: string): { incident?: IncidentRow; error?: string } {
  const id = input.trim();
  if (!id) return { error: "incident id 不能为空" };

  const exact = getIncident(id);
  if (exact) return { incident: exact };

  const matches = listIncidentsByIdPrefix(id, 6);
  if (matches.length === 1) return { incident: matches[0] };
  if (matches.length > 1) {
    return {
      error: `incident id 前缀 \`${id}\` 匹配多条：${matches.map((row) => row.id.slice(0, 8)).join(", ")}`,
    };
  }
  return { error: `找不到 incident \`${id}\`` };
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function incidentTaskTraceCandidate(
  incident: IncidentRow,
  cronRuns: CronRunRow[]
): Pick<IncidentTaskTraceContext, "taskId" | "source"> | undefined {
  if (incident.subject_type === "task" && incident.subject_id) {
    return { taskId: incident.subject_id, source: "incident_subject" };
  }

  const cronTaskId = cronRuns.find((row) => row.task_id)?.task_id;
  if (cronTaskId) {
    return { taskId: cronTaskId, source: "linked_cron_run" };
  }

  const source = parseJsonObject(incident.source_json);
  const sourceTaskId = stringValue(source.task_id);
  if (sourceTaskId) {
    return { taskId: sourceTaskId, source: "source_metadata" };
  }

  return undefined;
}

function buildIncidentTaskTraceContext(
  incident: IncidentRow,
  cronRuns: CronRunRow[]
): IncidentTaskTraceContext | undefined {
  const candidate = incidentTaskTraceCandidate(incident, cronRuns);
  if (!candidate) return undefined;

  const resolved = resolveTaskForTrace(candidate.taskId);
  if (!resolved.ok) {
    return { ...candidate, error: resolved.error };
  }

  const model = buildTaskTraceModel(resolved.value.id, { maxEvents: 6 });
  if (!model.ok) {
    return { taskId: resolved.value.id, source: candidate.source, error: model.error };
  }

  return { taskId: resolved.value.id, source: candidate.source, model: model.value };
}

async function sendIncidentOperationSummary(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  try {
    const channel = await resolveDoctorSummaryChannel(interaction.client);
    if (!channel) return;
    await channel.send(content.slice(0, 1900));
  } catch (err) {
    log.error("Failed to send incident operation summary:", err);
  }
}

export async function handleIncident(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand(true);
  const id = interaction.options.getString("id", true);
  const { incident, error } = resolveIncident(id);
  if (!incident) {
    await interaction.reply({ content: `❌ ${error}`, ephemeral: true });
    return;
  }

  if (subcommand === "view") {
    const events = listIncidentEvents(incident.id, 8);
    const repairRuns = listRepairRunsForIncident(incident.id, 5);
    const cronRuns = incident.subject_type === "cron" ? listCronRunsForIncident(incident.id, 3) : [];
    const taskTrace = buildIncidentTaskTraceContext(incident, cronRuns);
    await interaction.reply({
      content: formatIncidentDetail({ incident, events, repairRuns, cronRuns, taskTrace }),
      ephemeral: true,
    });
    return;
  }

  if (subcommand === "resolve" || subcommand === "ignore") {
    const status = subcommand === "resolve" ? "resolved" : "ignored";
    const reason = interaction.options.getString("reason") ?? undefined;
    markIncidentStatus(incident.id, status);
    appendIncidentEvent(incident.id, status === "resolved" ? "incident_resolved" : "incident_ignored", {
      user_id: interaction.user.id,
      previous_status: incident.status,
      reason,
    });
    await interaction.reply({
      content: formatIncidentResolution(status, incident, reason),
      ephemeral: true,
    });
    return;
  }

  if (subcommand === "retry-repair") {
    const retryableStatuses = new Set(["open", "diagnosed", "repair_blocked"]);
    if (!retryableStatuses.has(incident.status)) {
      await interaction.reply({
        content: `❌ Incident ${incident.id.slice(0, 8)} 当前状态为 \`${incident.status}\`，不能 retry repair。`,
        ephemeral: true,
      });
      return;
    }

    const policy = evaluateRepairPolicy(incident, true, false);
    if (!policy.allowed) {
      await interaction.reply({
        content: [
          `❌ Incident ${incident.id.slice(0, 8)} 不符合 retry repair policy。`,
          "",
          ...policy.blockers.map((item) => `- ${item}`),
        ].join("\n").slice(0, 1900),
        ephemeral: true,
      });
      return;
    }

    markIncidentStatus(incident.id, "diagnosed");
    appendIncidentEvent(incident.id, "repair_retry_requested", {
      user_id: interaction.user.id,
      previous_status: incident.status,
    });
    await interaction.reply({
      content: [
        `✅ Incident ${incident.id.slice(0, 8)} 已重新开放为 \`diagnosed\`。`,
        "下一次 scheduled Auto Doctor scan 会按现有 policy/rate limit 尝试 repair；不会绕过 allowed paths、dirty worktree 或 approval gates。",
      ].join("\n"),
      ephemeral: true,
    });
    return;
  }

  if (subcommand === "ship-preview") {
    await interaction.deferReply({ ephemeral: true });
    const result = await runDoctorShip({
      incidentId: incident.id,
      dryRun: true,
      execute: false,
      approveMain: false,
      restart: false,
      app: "miniclaw",
      json: false,
    });
    appendIncidentEvent(incident.id, "ship_preview_requested", {
      user_id: interaction.user.id,
      status: result.status,
      branch: result.branch,
      commit_sha: result.commitSha,
    });
    const summary = formatDoctorShipResult(result).slice(0, 1900);
    await interaction.editReply(summary);
    await sendIncidentOperationSummary(interaction, summary);
    return;
  }

  if (subcommand === "approve-ship" || subcommand === "request-restart") {
    await interaction.deferReply({ ephemeral: true });
    const restart = subcommand === "request-restart"
      ? true
      : interaction.options.getBoolean("restart") ?? false;
    const result = await runDoctorShip({
      incidentId: incident.id,
      dryRun: false,
      execute: true,
      approveMain: true,
      restart,
      app: "miniclaw",
      json: false,
    });
    appendIncidentEvent(incident.id, subcommand === "approve-ship" ? "ship_approved_from_discord" : "restart_requested_from_discord", {
      user_id: interaction.user.id,
      status: result.status,
      branch: result.branch,
      commit_sha: result.commitSha,
      restart_requested: restart,
      main_updated: result.mainUpdated,
      restart_attempted: result.restartAttempted,
    });
    const summary = formatDoctorShipResult(result).slice(0, 1900);
    await interaction.editReply(summary);
    await sendIncidentOperationSummary(interaction, summary);
    return;
  }

  await interaction.reply({ content: "未知 incident 操作", ephemeral: true });
}

export async function handleDoctor(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return;
  }

  const taskIdPrefix = interaction.options.getString("task_id") ?? undefined;
  const cronJobName = interaction.options.getString("cron") ?? undefined;
  const mode: DoctorMode = taskIdPrefix ? "task" : cronJobName ? "cron" : "recent";

  await interaction.deferReply({ ephemeral: true });
  const report = await runDoctor({
    mode,
    taskIdPrefix,
    cronJobName,
    json: false,
    dbPath: config.dbPath,
    connectivityStatePath: config.connectivity.statePath,
    cwd: process.cwd(),
  });

  await interaction.editReply(formatDoctorReport(report).slice(0, 1900));
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

  const capacity = taskCapacityError();
  if (capacity) {
    await interaction.reply({
      content: capacity,
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
    assertProviderSession(match.session_id, config.runtime.defaultAgent);
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

  const sourceMetadata = withTaskThreadMetadata(
    buildTaskSourceFromInteraction(interaction, "slash_resume", { cwd }),
    thread
  );
  createTask({
    id: newTaskId,
    discord_thread_id: thread.id,
    discord_user_id: interaction.user.id,
    prompt: followup,
    cwd,
    ...(sourceMetadata?.route_type ? { source_route_type: sourceMetadata.route_type } : {}),
    ...(sourceMetadata?.source_channel_id ? { source_channel_id: sourceMetadata.source_channel_id } : {}),
    ...(sourceMetadata?.source_message_id ? { source_message_id: sourceMetadata.source_message_id } : {}),
    ...(sourceMetadata?.source_message_url ? { source_message_url: sourceMetadata.source_message_url } : {}),
    ...(sourceMetadata ? { source_metadata_json: JSON.stringify(sourceMetadata) } : {}),
  });
  const reporter = new TaskReporter(newTaskId);
  reporter.accepted({
    route: sourceMetadata?.route_type ?? "slash_resume",
    cwd,
    user_id: interaction.user.id,
    thread_id: thread.id,
    resume_session_id: match.session_id,
  });
  reporter.contextCaptured({
    has_source_metadata: Boolean(sourceMetadata),
    has_parent_context: false,
    source_route_type: sourceMetadata?.route_type,
    source_channel_id: sourceMetadata?.source_channel_id,
    source_message_url: sourceMetadata?.source_message_url,
  });

  await interaction.editReply(`✅ 恢复任务，请查看线程 <#${thread.id}>`);
  let statusMessage;
  try {
    statusMessage = await thread.send({
      embeds: [taskStartEmbed(newTaskId, `[恢复] ${followup}`, cwd, {
        provider: config.runtime.defaultAgent,
        model: config.model,
      })],
    });
  } catch (err) {
    reporter.discordDeliveryFailed("slash_resume_status_send", err);
    throw err;
  }

  if (!thread.isTextBased() || thread.type !== ChannelType.PublicThread) {
    await interaction.editReply("❌ 线程创建异常");
    return;
  }

  const resumePrompt = buildTaskPromptWithContext(followup, {
    ...(sourceMetadata ? { source: sourceMetadata } : {}),
  });

  executeTask({
    taskId: newTaskId,
    prompt: resumePrompt,
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

  const row = addMemory(type, name, content, {
    source: "slash_remember",
    ttl: type === "reference" ? "reference" : type === "project" ? "project" : "stable",
  });
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
