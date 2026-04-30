// chatOnce: 单 agent 单 turn 调用 — 给定 persona + scene history → 拿到一段回复
//
// 设计要点：
// - 完全无副作用（不写 DB / 不读 memory），由 orchestrator 决定持久化
// - history 全量喂入（按 SceneMessage 转 user/assistant 角色）
// - 自带 abortController；chat-tools 复用 src/agent/chat-tools.ts
// - 沿用 src/agent/chat.ts 的 tool loop 结构

import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  TextBlockParam,
  ToolResultBlockParam,
  ToolUnion,
} from "@anthropic-ai/sdk/resources/messages.js";
import { config } from "../config.js";
import { CHAT_TOOLS, executeTool } from "../agent/chat-tools.js";
import { createLogger } from "../lib/log.js";
import type {
  ChatOnceCallbacks,
  ChatOnceResult,
  Persona,
  SceneMessage,
  ToolCallRecord,
} from "./types.js";
import { codexInput, codexThreadOptions, formatCodexItemLine, getCodexClient, withCodexTimeout } from "../agent/codex.js";

const log = createLogger("agent");

const MAX_ITERATIONS = 8;
const MAX_TOKENS_PER_TURN = 4096;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    if (!config.anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is required when MINICLAW_AGENT_PROVIDER=claude");
    }
    client = new Anthropic({
      apiKey: config.anthropicApiKey,
      ...(config.anthropicBaseUrl ? { baseURL: config.anthropicBaseUrl } : {}),
    });
  }
  return client;
}

/**
 * 把 scene messages 转成 Anthropic API 的 messages 数组。
 * - 当前 persona 自己的 message → assistant 角色
 * - 其它人（含 user 和别的 persona）→ user 角色，前缀 [发言人]
 * - 这是简化方案：让模型把"别人说的话"理解成"用户带过来的上下文"
 */
function buildMessages(persona: Persona, scene: SceneMessage[]): MessageParam[] {
  const out: MessageParam[] = [];
  let pendingUserChunks: string[] = [];

  const flushUser = () => {
    if (pendingUserChunks.length) {
      out.push({ role: "user", content: pendingUserChunks.join("\n\n") });
      pendingUserChunks = [];
    }
  };

  for (const m of scene) {
    if (m.speaker === persona.id) {
      flushUser();
      out.push({ role: "assistant", content: m.content || "(空)" });
    } else {
      const tag = m.speaker === "user" ? "user" : `@${m.speaker}`;
      pendingUserChunks.push(`[${tag}] ${m.content}`);
    }
  }
  flushUser();

  // Anthropic API 要求最后一条必须是 user。如果 history 末尾是 assistant（自己上轮回复），
  // 加一条空 user 占位（实际场景不会走到这里 —— 调度时该 persona 不会被连续选中）
  if (out.length && out[out.length - 1].role === "assistant") {
    out.push({ role: "user", content: "(继续)" });
  }
  if (!out.length) {
    out.push({ role: "user", content: "(开始对话)" });
  }
  return out;
}

function filterTools(persona: Persona): ToolUnion[] {
  if (!persona.tools || !persona.tools.length) return CHAT_TOOLS;
  const allow = new Set(persona.tools);
  return CHAT_TOOLS.filter((t) => allow.has(t.name));
}

export async function chatOnce(
  persona: Persona,
  history: SceneMessage[],
  callbacks: ChatOnceCallbacks = {},
  abortSignal?: AbortSignal,
): Promise<ChatOnceResult> {
  if (config.agentProvider === "codex") {
    return chatOnceCodex(persona, history, callbacks, abortSignal);
  }

  const startedAt = Date.now();
  const messages = buildMessages(persona, history);
  const tools = filterTools(persona);
  const ant = getClient();

  let iters = 0;
  let toolCalls: ToolCallRecord[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let aborted = false;
  let lastAssistantText = "";

  callbacks.onStatus?.("thinking");
  log.info(`▶ ${persona.id} turn start (history=${history.length})`);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (abortSignal?.aborted) {
      aborted = true;
      break;
    }
    iters++;

    let finalMsg;
    try {
      const stream = ant.messages.stream({
        model: persona.model ?? config.claudeModel,
        max_tokens: MAX_TOKENS_PER_TURN,
        system: persona.systemPrompt,
        tools,
        messages,
      });

      if (callbacks.onText) {
        stream.on("text", (delta) => {
          if (delta) callbacks.onText!(delta);
        });
      }

      finalMsg = await stream.finalMessage();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`${persona.id} stream error: ${msg}`);
      throw err;
    }

    inputTokens += finalMsg.usage?.input_tokens ?? 0;
    outputTokens += finalMsg.usage?.output_tokens ?? 0;
    cacheReadTokens += finalMsg.usage?.cache_read_input_tokens ?? 0;
    cacheCreationTokens += finalMsg.usage?.cache_creation_input_tokens ?? 0;

    messages.push({ role: "assistant", content: finalMsg.content });

    // 收集本轮所有 text 块作为最新的 assistant 回复
    const texts: string[] = [];
    for (const b of finalMsg.content) {
      if ((b as { type: string }).type === "text") {
        texts.push((b as { type: "text"; text: string }).text);
      }
    }
    if (texts.length) lastAssistantText = texts.join("\n").trim();

    if (finalMsg.stop_reason !== "tool_use") break;

    // 执行 tool_use
    const toolResults: ToolResultBlockParam[] = [];
    for (const block of finalMsg.content) {
      if (block.type !== "tool_use") continue;
      if (abortSignal?.aborted) {
        aborted = true;
        break;
      }
      callbacks.onStatus?.("tool-call");
      const result = await executeTool(block.name, block.input);
      const tc: ToolCallRecord = {
        name: block.name,
        input: block.input,
        result: result.content.slice(0, 500),
        ...(result.is_error ? { isError: true } : {}),
      };
      toolCalls.push(tc);
      callbacks.onToolCall?.(tc);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.content,
        is_error: result.is_error,
      });
    }
    if (aborted) break;
    if (!toolResults.length) break;
    messages.push({ role: "user", content: toolResults });
    callbacks.onStatus?.("thinking");
  }

  if (!lastAssistantText) lastAssistantText = "(无文字回复)";

  // 估算成本（只对照 sonnet-4-6 / opus 价位粗算；精确成本走 sdk 不带，要外算）
  const costUsd = estimateCost(persona.model ?? config.claudeModel, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens);

  callbacks.onStatus?.(aborted ? "aborted" : "done");
  log.info(
    `${aborted ? "✗" : "✓"} ${persona.id} ${Date.now() - startedAt}ms iters=${iters} ` +
    `tools=${toolCalls.length} cost=$${costUsd.toFixed(4)} tok in=${inputTokens} out=${outputTokens}`
  );

  // 引用解析（mentions 在调用方知道 registry，这里只解析字符串里的 @ 引用模式）
  const mentions = extractMentionIds(lastAssistantText, persona.id);

  return {
    content: lastAssistantText,
    mentions,
    toolCalls,
    costUsd,
    iters,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    aborted,
  };
}

async function chatOnceCodex(
  persona: Persona,
  history: SceneMessage[],
  callbacks: ChatOnceCallbacks = {},
  abortSignal?: AbortSignal,
): Promise<ChatOnceResult> {
  const startedAt = Date.now();
  callbacks.onStatus?.("thinking");
  log.info(`▶ ${persona.id} codex turn start (history=${history.length})`);

  const transcript = history
    .map((m) => `[${m.speaker === persona.id ? "你" : m.speaker}] ${m.content}`)
    .join("\n");
  const prompt = [
    `你正在 MiniClaw stage 中扮演 @${persona.id} (${persona.name})。`,
    persona.systemPrompt,
    "请只输出你这名角色下一轮要说的话。需要呼叫其他角色时使用 @角色id。用中文回复，不要解释系统规则。",
    transcript ? `<scene_history>\n${transcript}\n</scene_history>` : "<scene_history>(开始对话)</scene_history>",
  ].join("\n\n");

  const baseCtrl = new AbortController();
  if (abortSignal?.aborted) baseCtrl.abort();
  else abortSignal?.addEventListener("abort", () => baseCtrl.abort(), { once: true });
  const timeoutCtrl = withCodexTimeout(baseCtrl.signal, config.codex.timeoutMs);

  const codex = getCodexClient();
  const thread = codex.startThread(codexThreadOptions("stage", config.defaultCwd));
  const { events } = await thread.runStreamed(codexInput(prompt), { signal: timeoutCtrl.signal });

  let lastAssistantText = "";
  const toolCalls: ToolCallRecord[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let aborted = false;
  let failedMessage = "";
  let iters = 1;

  for await (const event of events) {
    if (abortSignal?.aborted || timeoutCtrl.signal.aborted) {
      aborted = true;
      break;
    }
    switch (event.type) {
      case "turn.completed":
        inputTokens = event.usage.input_tokens;
        outputTokens = event.usage.output_tokens;
        cacheReadTokens = event.usage.cached_input_tokens;
        break;
      case "turn.failed":
        failedMessage = event.error.message;
        break;
      case "error":
        failedMessage = event.message;
        break;
      case "item.started":
      case "item.updated":
      case "item.completed":
        if (event.item.type === "agent_message") {
          lastAssistantText = event.item.text;
          callbacks.onText?.(lastAssistantText);
          break;
        }
        {
          const line = formatCodexItemLine(event.item);
          if (line) {
            callbacks.onStatus?.("tool-call");
            const tc: ToolCallRecord = {
              name: event.item.type,
              input: line,
              ...(event.item.type === "error" ? { isError: true } : {}),
            };
            toolCalls.push(tc);
            callbacks.onToolCall?.(tc);
          }
        }
        break;
    }
  }
  if (!timeoutCtrl.signal.aborted) timeoutCtrl.abort();

  if (failedMessage) {
    log.error(`${persona.id} codex error: ${failedMessage}`);
    lastAssistantText = `(${persona.name} 暂时无法回复：${failedMessage})`;
  }
  if (!lastAssistantText) lastAssistantText = "(无文字回复)";

  callbacks.onStatus?.(aborted ? "aborted" : "done");
  log.info(
    `${aborted ? "✗" : "✓"} ${persona.id} codex ${Date.now() - startedAt}ms ` +
    `tools=${toolCalls.length} tok in=${inputTokens} out=${outputTokens}`
  );

  const mentions = extractMentionIds(lastAssistantText, persona.id);
  return {
    content: lastAssistantText,
    mentions,
    toolCalls,
    costUsd: 0,
    iters,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens: 0,
    aborted,
  };
}

/**
 * 提取 @ 引用，过滤自指。registry 校验交给 orchestrator 做（agent.ts 不依赖 Scene）。
 */
function extractMentionIds(text: string, selfId: string): string[] {
  const re = /@([A-Za-z0-9_-]+)/g;
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = m[1].toLowerCase();
    if (id === selfId) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * 粗略成本估算（USD）。
 * sonnet-4-6: $3/M in, $15/M out, $0.30/M cache hit, $3.75/M cache write
 * opus-4-7:   $15/M in, $75/M out, $1.50/M cache hit, $18.75/M cache write
 * 默认按 sonnet 算；模型名包含 opus 切到 opus 价位
 */
function estimateCost(model: string, inTok: number, outTok: number, cacheR: number, cacheW: number): number {
  const isOpus = /opus/i.test(model);
  const inRate = isOpus ? 15 : 3;
  const outRate = isOpus ? 75 : 15;
  const cacheRRate = isOpus ? 1.5 : 0.3;
  const cacheWRate = isOpus ? 18.75 : 3.75;
  return (inTok * inRate + outTok * outRate + cacheR * cacheRRate + cacheW * cacheWRate) / 1_000_000;
}

export const __testables = { buildMessages, extractMentionIds, estimateCost };
