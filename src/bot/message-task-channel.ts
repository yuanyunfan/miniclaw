import type { Message } from "discord.js";
import {
  createAndRunDiscordTask,
  formatTaskCompletionNotice,
  taskCapacityError,
} from "../discord/task-intake.js";
import {
  buildTaskSourceFromMessage,
  resolveReplyParentContext,
} from "../discord/task-context.js";
import { createLogger } from "../lib/log.js";
import { resolveTaskCwd } from "../routing/cwd.js";

const log = createLogger("bot");

export interface TaskChannelMessageOptions {
  botUserId: string;
  markProcessed: (messageId: string) => boolean;
}

export function stripBotMention(content: string, botUserId: string): string {
  return content.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
}

export async function handleTaskChannelMessage(
  message: Message,
  options: TaskChannelMessageOptions
): Promise<void> {
  if (!options.markProcessed(message.id)) return;

  const content = stripBotMention(message.content, options.botUserId);
  const atts = Array.from(message.attachments.values());
  if (!content && !atts.length) {
    await message.reply("请直接发送任务描述，或附上文件后说明要 MiniClaw 做什么。");
    return;
  }

  const capacity = taskCapacityError();
  if (capacity) {
    await message.reply(capacity);
    return;
  }

  const cwd = resolveTaskCwd(message.channel.id);
  const effectivePrompt = content || "请处理这些附件";
  const parentContext = await resolveReplyParentContext(message);

  await message.react("👀").catch(() => {});
  try {
    await createAndRunDiscordTask({
      prompt: effectivePrompt,
      cwd,
      userId: message.author.id,
      attachments: atts,
      taskContext: {
        source: buildTaskSourceFromMessage(message, "task_channel", {
          cwd,
          wasMentioned: message.mentions.has(options.botUserId),
        }),
        ...(parentContext ? { parent: parentContext } : {}),
      },
      createThread: (name) => message.startThread({
        name,
        autoArchiveDuration: 1440,
      }),
      onCreated: async (result) => {
        await message.reply(`✅ 任务已创建，请查看线程 <#${result.threadId}>`);
      },
      onCompleted: async (result, taskResult) => {
        await message.reply(formatTaskCompletionNotice(result, taskResult));
      },
    });
  } catch (err) {
    log.error("Task channel message failed:", err);
    await message.reactions.cache.get("👀")?.users.remove(options.botUserId).catch(() => {});
    await message.react("❌").catch(() => {});
    await message.reply(`❌ 创建任务失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}
