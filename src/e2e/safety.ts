import { config } from "../config.js";

export function isAllowedDiscordMessageAuthor(userId: string, isBot: boolean): boolean {
  if (isBot) {
    return config.e2e.mode && config.e2e.senderUserIds.includes(userId);
  }
  return userId === config.allowedUserId || (config.e2e.mode && config.e2e.senderUserIds.includes(userId));
}
