import { getDb } from "../connection.js";

export interface ChatHistoryRow {
  role: string;
  content: string;
}

export function addChatMessage(channelId: string, userId: string, role: string, content: string): void {
  getDb()
    .prepare(
      `INSERT INTO chat_history (discord_channel_id, discord_user_id, role, content) VALUES (?, ?, ?, ?)`
    )
    .run(channelId, userId, role, content);
}

export function getChatHistory(channelId: string, limit = 20): ChatHistoryRow[] {
  return getDb()
    .prepare(
      `SELECT role, content FROM chat_history
       WHERE discord_channel_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(channelId, limit) as ChatHistoryRow[];
}
