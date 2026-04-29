// Stage Manager: auto 模式下决定下一发言者
//
// 调用一次小成本 LLM（sonnet），输入 = 参与者描述 + 最近 N 条消息 + 规则
// 输出 JSON: { next_speaker: "<id>" | "user" | "end", reason: "..." }
//
// 由 orchestrator 在 mode=auto 且队列空时调用

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { createLogger } from "../lib/log.js";
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

const SYSTEM_PROMPT = `你是 MiniClaw Stage 的导演（Stage Manager）。看完 scene 中最近的对话，判断**下一个最该发言的角色**。

## 决策规则
1. 如果最后一条消息显式 @ 了某 persona 且对方在场 → 选那个 persona
2. 如果最后一条是某 agent 的"完成报告"且无 @ → 选 user（让用户决定下一步）
3. 如果对话已自然结束（明确说"完成"、"已发"、"结束"等）→ "end"
4. 如果最后一条同 speaker 已连续 ≥2 turn → 不能再选同一个，强制切换或选 user
5. 如果有"测试用例""验收"待 review → 选 tester（如在场）
6. 如果有需要技术实现/代码探查 → 选 engineer（如在场）
7. 否则按对话流逻辑选最该接的人

## 输出格式
**只输出 JSON**，无其他文字：
{"next_speaker": "<persona_id 或 user 或 end>", "reason": "<不超过 30 字>"}

不要 markdown 代码围栏。不要解释。只要一行 JSON。`;

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
