import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { addMemory, getAllMemories } from "../store/memory.js";

const EXTRACT_SYSTEM = `你是一个记忆提取助手。分析用户和助手的对话，提取值得长期记住的信息。

只提取以下类型的信息：
- user: 用户的身份、角色、偏好、知识背景
- feedback: 用户对回答方式的反馈和纠正
- project: 正在进行的项目、目标、截止日期等
- reference: 外部资源的位置、链接等

输出 JSON 数组，每个元素 {"type", "name", "content"}。name 不超过 30 字符。
如果没有值得记住的信息，输出空数组 []。

注意：
- 不要提取临时性的、只在当前对话有用的信息
- 不要重复已有的记忆
- 简单问候、闲聊不需要提取`;

export async function extractMemories(
  userMsg: string,
  assistantReply: string,
  existingMemories?: Array<{ type: string; name: string; content: string }>
): Promise<void> {
  if (userMsg.length < 10) return;

  const greetings = /^(hi|hello|hey|你好|嗨|早|晚安|谢谢|ok|好的|嗯)$/i;
  if (greetings.test(userMsg.trim())) return;

  try {
    const existing = existingMemories ?? getAllMemories().map((m) => ({
      type: m.type, name: m.name, content: m.content,
    }));

    const existingBlock = existing.length
      ? `\n已有记忆:\n${existing.map((m) => `- [${m.type}] ${m.name}: ${m.content}`).join("\n")}`
      : "";

    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: EXTRACT_SYSTEM,
      messages: [
        {
          role: "user",
          content: `用户消息: ${userMsg}\n\n助手回复: ${assistantReply.slice(0, 1000)}${existingBlock}\n\n请提取值得长期记住的信息，输出 JSON 数组:`,
        },
      ],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const items = JSON.parse(jsonMatch[0]) as Array<{ type: string; name: string; content: string }>;
    if (!Array.isArray(items)) return;

    for (const item of items) {
      if (item.type && item.name && item.content) {
        addMemory(item.type, item.name.slice(0, 30), item.content);
      }
    }
  } catch (err) {
    console.error("[MiniClaw] Memory extraction failed:", err);
  }
}
