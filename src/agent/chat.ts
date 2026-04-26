import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { addChatMessage, getChatHistory } from "../store/db.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

export async function chat(
  channelId: string,
  userId: string,
  prompt: string
): Promise<string> {
  addChatMessage(channelId, userId, "user", prompt);

  const history = getChatHistory(channelId, 20).reverse();
  const messages = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 4096,
    system: "你是 MiniClaw，一个简洁高效的个人 AI 助手。用中文回复。简洁直接，不啰嗦。",
    messages,
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "[无文本回复]";

  addChatMessage(channelId, userId, "assistant", text);
  return text;
}
