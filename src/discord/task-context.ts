import type {
  AnyThreadChannel,
  Attachment,
  ChatInputCommandInteraction,
  Message,
} from "discord.js";
import type {
  TaskAttachmentSummary,
  TaskParentContext,
  TaskRouteType,
  TaskSourceMetadata,
} from "../routing/task-context.js";

type ChannelLike = {
  id?: string;
  name?: string | null;
  type?: unknown;
  isThread?: () => boolean;
  parentId?: string | null;
  parent?: { id?: string; name?: string | null } | null;
};

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanContent(value: unknown, maxChars = 4000): string | undefined {
  const text = cleanString(value);
  if (!text) return undefined;
  const cleaned = text.replaceAll("\0", "").trim();
  if (!cleaned) return undefined;
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars - 15).trimEnd()}...[truncated]` : cleaned;
}

function compact<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out as T;
}

function channelLike(value: unknown): ChannelLike {
  return value && typeof value === "object" ? value as ChannelLike : {};
}

function channelName(channel: unknown): string | undefined {
  return cleanString(channelLike(channel).name);
}

function channelType(channel: unknown): string | undefined {
  const type = channelLike(channel).type;
  return type === undefined ? undefined : String(type);
}

function isoTimestamp(value: unknown): string | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return undefined;
}

function attachmentSummaries(attachments: Iterable<Attachment> | undefined): TaskAttachmentSummary[] | undefined {
  if (!attachments) return undefined;
  const summaries = Array.from(attachments).map((att) => compact({
    name: cleanString(att.name),
    content_type: cleanString(att.contentType),
    size_bytes: Number.isFinite(att.size) ? att.size : undefined,
  }));
  return summaries.length ? summaries : undefined;
}

function messageAttachments(message: Message): Attachment[] {
  return Array.from(message.attachments.values());
}

export function buildTaskSourceFromMessage(
  message: Message,
  routeType: TaskRouteType,
  opts: {
    cwd: string;
    wasMentioned?: boolean;
  },
): TaskSourceMetadata {
  const channel = channelLike(message.channel);
  const isThread = channel.isThread?.() === true;
  const parent = isThread ? channel.parent : undefined;

  return compact({
    provider: "discord" as const,
    route_type: routeType,
    guild_id: cleanString(message.guildId ?? message.guild?.id),
    guild_name: cleanString(message.guild?.name),
    source_channel_id: cleanString(message.channelId ?? channel.id),
    source_channel_name: channelName(message.channel),
    source_channel_type: channelType(message.channel),
    source_message_id: cleanString(message.id),
    source_message_url: cleanString(message.url),
    parent_channel_id: isThread ? cleanString(channel.parentId ?? parent?.id) : undefined,
    parent_channel_name: isThread ? channelName(parent) : undefined,
    author_id: cleanString(message.author?.id),
    author_username: cleanString(message.author?.username),
    author_display_name: cleanString(message.member?.displayName ?? message.author?.globalName),
    timestamp: isoTimestamp(message.createdTimestamp ?? message.createdAt),
    cwd: opts.cwd,
    was_mentioned: opts.wasMentioned === true ? true : undefined,
    attachments: attachmentSummaries(messageAttachments(message)),
  });
}

export function buildTaskSourceFromInteraction(
  interaction: ChatInputCommandInteraction,
  routeType: TaskRouteType,
  opts: { cwd: string },
): TaskSourceMetadata {
  return compact({
    provider: "discord" as const,
    route_type: routeType,
    guild_id: cleanString(interaction.guildId ?? interaction.guild?.id),
    guild_name: cleanString(interaction.guild?.name),
    source_channel_id: cleanString(interaction.channelId),
    source_channel_name: channelName(interaction.channel),
    source_channel_type: channelType(interaction.channel),
    source_message_id: cleanString(interaction.id),
    author_id: cleanString(interaction.user.id),
    author_username: cleanString(interaction.user.username),
    author_display_name: cleanString(interaction.member && "displayName" in interaction.member
      ? interaction.member.displayName
      : interaction.user.globalName),
    timestamp: isoTimestamp(interaction.createdTimestamp ?? interaction.createdAt),
    cwd: opts.cwd,
  });
}

export function withTaskThreadMetadata(
  source: TaskSourceMetadata | undefined,
  thread: Pick<AnyThreadChannel, "id" | "name">,
): TaskSourceMetadata | undefined {
  if (!source) return undefined;
  return compact({
    ...source,
    task_thread_id: cleanString(thread.id),
    task_thread_name: cleanString(thread.name),
  });
}

function parentContextFromMessage(message: Message): TaskParentContext {
  return compact({
    kind: "reply" as const,
    provider: "discord" as const,
    message_id: cleanString(message.id),
    message_url: cleanString(message.url),
    channel_id: cleanString(message.channelId),
    author_id: cleanString(message.author?.id),
    author_username: cleanString(message.author?.username),
    author_display_name: cleanString(message.member?.displayName ?? message.author?.globalName),
    timestamp: isoTimestamp(message.createdTimestamp ?? message.createdAt),
    content: cleanContent(message.content),
    attachments: attachmentSummaries(messageAttachments(message)),
  });
}

export async function resolveReplyParentContext(message: Message): Promise<TaskParentContext | undefined> {
  const referenced = message.reference?.messageId
    ? await message.fetchReference().catch(() => null)
    : null;
  if (!referenced) return undefined;
  const context = parentContextFromMessage(referenced);
  return context.content || context.attachments?.length ? context : undefined;
}

export const __testables = {
  attachmentSummaries,
  buildTaskSourceFromMessage,
  buildTaskSourceFromInteraction,
  cleanContent,
};
