import {
  ChannelType,
  type ModalSubmitInteraction,
} from "discord.js";
import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import { executeTask } from "../agent/task.js";
import { formatSessionId } from "../agent/session.js";
import { TaskReporter } from "../agent/task-reporter.js";
import { taskStartEmbed } from "../discord/formatter.js";
import { taskCapacityError } from "../discord/task-intake.js";
import { parseCliSessionContinueModalId } from "../discord/cli-session-dashboard.js";
import { buildTaskPromptWithContext, type TaskSourceMetadata } from "../routing/task-context.js";
import { createTask, getCliSession } from "../store/db.js";
import { createLogger } from "../lib/log.js";
import { requestCliSessionDashboardRefresh } from "./cli-session-buttons.js";

const log = createLogger("cli-session-modal");

function sourceFromModal(
  interaction: ModalSubmitInteraction,
  session: NonNullable<ReturnType<typeof getCliSession>>,
): TaskSourceMetadata {
  return {
    provider: "discord",
    route_type: "cli_session_continue",
    guild_id: interaction.guildId ?? undefined,
    guild_name: interaction.guild?.name ?? undefined,
    source_channel_id: interaction.channelId ?? undefined,
    source_channel_name: interaction.channel && "name" in interaction.channel
      ? String(interaction.channel.name ?? "")
      : undefined,
    source_message_id: interaction.id,
    author_id: interaction.user.id,
    author_username: interaction.user.username,
    author_display_name: interaction.user.globalName ?? undefined,
    timestamp: new Date(interaction.createdTimestamp).toISOString(),
    cwd: session.cwd,
  };
}

export async function handleCliSessionModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  const parsed = parseCliSessionContinueModalId(interaction.customId);
  if (!parsed) return false;

  if (interaction.user.id !== config.allowedUserId) {
    await interaction.reply({ content: "No permission.", ephemeral: true });
    return true;
  }

  const session = getCliSession(parsed.sessionId);
  if (!session) {
    await interaction.reply({ content: "CLI session not found.", ephemeral: true });
    return true;
  }
  if (session.phase !== "waiting_for_input" || session.ended_at || session.hidden_at) {
    await interaction.reply({
      content: "This CLI session is not available for safe same-provider continuation.",
      ephemeral: true,
    });
    return true;
  }

  const followup = interaction.fields.getTextInputValue("followup").trim();
  if (!followup) {
    await interaction.reply({ content: "Follow-up instruction is empty.", ephemeral: true });
    return true;
  }
  const capacity = taskCapacityError();
  if (capacity) {
    await interaction.reply({ content: capacity, ephemeral: true });
    return true;
  }

  const parentChannel = interaction.channel;
  if (!parentChannel || !("threads" in parentChannel)) {
    await interaction.reply({ content: "Cannot create a task thread in this channel.", ephemeral: true });
    return true;
  }

  const taskId = uuid();
  const providerSessionId = formatSessionId(session.provider, session.provider_session_id);
  const thread = await parentChannel.threads.create({
    name: `resume ${session.provider} ${followup.replace(/\s+/g, " ").slice(0, 70)}`,
    autoArchiveDuration: 1440,
  });
  const source = sourceFromModal(interaction, session);
  source.task_thread_id = thread.id;
  source.task_thread_name = thread.name;

  createTask({
    id: taskId,
    discord_thread_id: thread.id,
    discord_user_id: interaction.user.id,
    prompt: followup,
    cwd: session.cwd,
    source_route_type: "cli_session_continue",
    source_channel_id: interaction.channelId ?? undefined,
    source_message_id: interaction.id,
    source_metadata_json: JSON.stringify({
      ...source,
      cli_session_id: session.id,
      cli_session_provider: session.provider,
      cli_provider_session_id: session.provider_session_id,
    }),
  });
  const reporter = new TaskReporter(taskId);
  reporter.accepted({
    route: "cli_session_continue",
    cwd: session.cwd,
    user_id: interaction.user.id,
    thread_id: thread.id,
    resume_session_id: providerSessionId,
    cli_session_id: session.id,
  });

  await interaction.reply({
    content: `Created same-provider continuation <#${thread.id}> for ${session.provider} session ${session.id.slice(0, 8)}.`,
    ephemeral: true,
  });
  requestCliSessionDashboardRefresh();
  const statusMessage = await thread.send({
    embeds: [taskStartEmbed(taskId, `[${session.provider} resume] ${followup}`, session.cwd, {
      provider: session.provider,
      model: session.provider === "claude" ? config.claudeModel : config.codex.model ?? "inherit",
    })],
  });

  if (!thread.isTextBased() || thread.type !== ChannelType.PublicThread) {
    await interaction.followUp({ content: "Thread creation returned an unsupported channel type.", ephemeral: true });
    return true;
  }

  const prompt = buildTaskPromptWithContext(followup, { source });
  executeTask({
    taskId,
    prompt,
    cwd: session.cwd,
    channel: thread,
    runtimeId: session.provider,
    resumeSessionId: providerSessionId,
    statusMessage,
  }).catch((err) => {
    log.error(`CLI session continuation task ${taskId} error:`, err);
  });

  return true;
}
