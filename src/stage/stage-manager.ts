// Stage Manager: auto 模式下决定下一发言者
//
// 调用一次小成本 LLM（sonnet），输入 = 参与者描述 + 最近 N 条消息 + 规则
// 输出 JSON: { next_speaker: "<id>" | "user" | "end", reason: "..." }
//
// 由 orchestrator 在 mode=auto 且队列空时调用

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { createLogger } from "../lib/log.js";
import { loadPrompt } from "../agent/prompts.js";
import type { Persona, SceneMessage } from "./types.js";

const log = createLogger("stage-manager");

const RECENT_TAIL = 12;
const MAX_TOKENS = 200;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: config.anthropicApiKey,
      ...(config.anthropicBaseUrl ? { baseURL: config.anthropicBaseUrl } : {}),
    });
  }
  return client;
}

export interface NextSpeakerDecision {
  next: string;          // persona id | "user" | "end"
  reason: string;
  costUsd: number;
}

const SYSTEM_PROMPT = loadPrompt("stage-manager");

export async function pickNextSpeaker(
  participants: Persona[],
  messages: SceneMessage[],
): Promise<NextSpeakerDecision> {
  const startedAt = Date.now();
  const tail = messages.slice(-RECENT_TAIL);

  const rosterDesc = participants.map((p) => `- ${p.id} (${p.name}): ${p.systemPrompt.slice(0, 80).replace(/\n/g, " ")}`).join("\n");

  const transcript = tail
    .map((m) => `[${m.speaker}] ${m.content.slice(0, 300).replace(/\n/g, " ")}`)
    .join("\n");

  const userPrompt = `## 在场角色
${rosterDesc}

## 最近 ${tail.length} 条对话
${transcript}

下一发言者是？`;

  const ant = getClient();
  let raw = "";
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const res = await ant.messages.create({
      model: config.model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    inputTokens = res.usage?.input_tokens ?? 0;
    outputTokens = res.usage?.output_tokens ?? 0;
    for (const b of res.content) {
      if ((b as { type: string }).type === "text") {
        raw += (b as { type: "text"; text: string }).text;
      }
    }
  } catch (err) {
    log.error("pickNextSpeaker LLM error:", err);
    return { next: "user", reason: "stage-manager 失败，交给用户", costUsd: 0 };
  }

  // 粗略 cost (sonnet)
  const costUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;

  const decision = parseDecision(raw, participants);
  log.info(`stage-manager → ${decision.next} (${decision.reason}) ${Date.now() - startedAt}ms cost=$${costUsd.toFixed(4)}`);
  return { ...decision, costUsd };
}

export function parseDecision(raw: string, participants: Persona[]): { next: string; reason: string } {
  // 从输出提取第一段 JSON
  const m = raw.match(/\{[\s\S]*?\}/);
  if (!m) return { next: "user", reason: "解析失败" };
  try {
    const obj = JSON.parse(m[0]);
    let next = String(obj.next_speaker ?? "user").toLowerCase().trim();
    const reason = String(obj.reason ?? "").slice(0, 80);
    if (next !== "user" && next !== "end") {
      const valid = participants.some((p) => p.id === next);
      if (!valid) next = "user";
    }
    return { next, reason };
  } catch {
    return { next: "user", reason: "JSON 解析失败" };
  }
}

export const __testables = { parseDecision, SYSTEM_PROMPT };
