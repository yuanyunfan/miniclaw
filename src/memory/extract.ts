import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { addMemory, getAllMemories } from "../store/memory.js";
import { createLogger } from "../lib/log.js";
import { loadPrompt } from "../agent/prompts.js";

const log = createLogger("memory-extract");

function buildExtractUserPrompt(userMsg: string, assistantReply: string, existingBlock: string): string {
  return `用户消息: ${userMsg}\n\n助手回复: ${assistantReply.slice(0, 1000)}${existingBlock}\n\n请提取值得长期记住的信息，输出 JSON 数组:`;
}

const EXTRACT_SYSTEM = loadPrompt("memory-extractor");

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
          content: buildExtractUserPrompt(userMsg, assistantReply, existingBlock),
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
    log.error("Memory extraction failed:", err);
  }
}

export const __testables = { EXTRACT_SYSTEM, buildExtractUserPrompt };
