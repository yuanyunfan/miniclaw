export type DiscordMessageRoute =
  | "ignore"
  | "thread_continuation"
  | "task_channel"
  | "chat";

export interface DiscordMessageRouteInput {
  authorAllowed: boolean;
  isThread: boolean;
  hasContinuableTask: boolean;
  channelId: string;
  taskChannelIds: readonly string[];
  autoReplyChannelIds: readonly string[];
  isMentioned: boolean;
}

export function resolveDiscordMessageRoute(input: DiscordMessageRouteInput): DiscordMessageRoute {
  if (!input.authorAllowed) return "ignore";
  if (input.isThread && input.hasContinuableTask) return "thread_continuation";
  if (input.taskChannelIds.includes(input.channelId)) return "task_channel";
  if (input.autoReplyChannelIds.includes("*") || input.autoReplyChannelIds.includes(input.channelId) || input.isMentioned) {
    return "chat";
  }
  return "ignore";
}
