import type { ChatInputCommandInteraction } from "discord.js";
import {
  handleAgentConfig,
  handleCancel,
  handleDoctor,
  handleForget,
  handleHealth,
  handleIncident,
  handleIncidents,
  handleMemories,
  handleRemember,
  handleResume,
  handleStatus,
  handleTask,
  handleTaskLog,
} from "../commands/handlers.js";
import { createLogger } from "../lib/log.js";

const log = createLogger("bot");

type SlashCommandHandler = (interaction: ChatInputCommandInteraction) => Promise<void>;

export interface SlashCommandDispatchDependencies {
  handlers: Readonly<Record<string, SlashCommandHandler>>;
  logError: (message: string, err: unknown) => void;
}

const defaultSlashCommandDispatchDependencies: SlashCommandDispatchDependencies = {
  handlers: {
    "task": handleTask,
    "status": handleStatus,
    "task-log": handleTaskLog,
    "health": handleHealth,
    "doctor": handleDoctor,
    "incidents": handleIncidents,
    "incident": handleIncident,
    "agent-config": handleAgentConfig,
    "cancel": handleCancel,
    "resume": handleResume,
    "remember": handleRemember,
    "forget": handleForget,
    "memories": handleMemories,
  },
  logError: (message, err) => log.error(message, err),
};

export async function dispatchSlashCommand(
  cmd: ChatInputCommandInteraction,
  dependencies: SlashCommandDispatchDependencies = defaultSlashCommandDispatchDependencies
): Promise<void> {
  try {
    const handler = dependencies.handlers[cmd.commandName];
    if (!handler) {
      await cmd.reply({ content: "未知命令", ephemeral: true });
      return;
    }
    await handler(cmd);
  } catch (err) {
    dependencies.logError("Command error:", err);
    const reply = { content: "❌ 命令执行出错", ephemeral: true };
    try {
      if (cmd.deferred || cmd.replied) {
        await cmd.editReply(reply.content);
      } else {
        await cmd.reply(reply);
      }
    } catch (replyErr) {
      dependencies.logError("Failed to send error reply:", replyErr);
    }
  }
}
