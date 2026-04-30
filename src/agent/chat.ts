import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  TextBlockParam,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages.js";
import { config } from "../config.js";
import { addChatMessage, getChatHistory } from "../store/db.js";
import { buildMemoryPrompt } from "../memory/inject.js";
import { extractMemories } from "../memory/extract.js";
import { createLogger } from "../lib/log.js";
import { CHAT_TOOLS, executeTool } from "./chat-tools.js";
import type { CodexInputEntry } from "./codex.js";
import { codexInput, codexThreadOptions, formatCodexItemLine, getCodexClient, withCodexTimeout } from "./codex.js";
import { formatCodexUsage } from "./usage.js";

const log = createLogger("chat");

export interface ChatCallbacks {
  onToolUse: (display: string) => void;
  onText: (text: string) => void;
}

const MAX_ITERATIONS = 10;
const MAX_TOKENS_PER_TURN = 4096;
const HISTORY_LIMIT = 15;

import { buildChatIdentityLine } from "./identity.js";

const IDENTITY_LINE = buildChatIdentityLine();

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    if (!config.anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is required when MINICLAW_AGENT_PROVIDER=claude");
    }
    client = new Anthropic({
      apiKey: config.anthropicApiKey,
      // 显式传 baseURL：claude-agent-sdk 在 import 时会篡改 process.env.ANTHROPIC_BASE_URL
      // 指向 SDK 内部 proxy（一个临时端口），那不是给 chat 路径用的
      ...(config.anthropicBaseUrl ? { baseURL: config.anthropicBaseUrl } : {}),
    });
  }
  return client;
}

export async function chat(
  channelId: string,
  userId: string,
  prompt: string,
  attachmentBlocks?: ContentBlockParam[],
  callbacks?: ChatCallbacks,
  attachmentCodexInputs?: CodexInputEntry[],
): Promise<string> {
  const startedAt = Date.now();
  const chShort = channelId.slice(-6);
  const hasAttach = !!(attachmentBlocks && attachmentBlocks.length);
  log.info(`▶ chat ch=${chShort} attach=${hasAttach ? attachmentBlocks!.length : 0} prompt="${prompt.slice(0, 60).replace(/\s+/g, " ")}"`);

  addChatMessage(channelId, userId, "user", prompt);

  // 构建 system：identity + memory + history（history 放 system 而非 messages，避免每轮 tool loop 重复）
  const memoryBlock = buildMemoryPrompt();
  const history = getChatHistory(channelId, 30).reverse();
  const historyBlock = buildHistoryPrompt(history.slice(0, -1));
  const systemParts = [IDENTITY_LINE, memoryBlock, historyBlock].filter(Boolean);
  const system = systemParts.join("\n\n");

  if (config.agentProvider === "codex") {
    const result = await chatWithCodex(system, prompt, attachmentCodexInputs, callbacks);
    log.info(
      `✓ chat/codex ch=${chShort} ${Date.now() - startedAt}ms ` +
      `tools=${result.toolCount} reply.len=${result.reply.length}` +
      (result.tokensSummary ? ` ${result.tokensSummary}` : "")
    );
    addChatMessage(channelId, userId, "assistant", result.reply);
    extractMemories(prompt, result.reply).catch((err) => {
      log.error("Background memory extraction error:", err);
    });
    return result.reply;
  }

  // 首轮 user message：附件 + 文字
  const userContent: ContentBlockParam[] = [
    ...(attachmentBlocks ?? []),
    { type: "text", text: prompt } as TextBlockParam,
  ];
  const messages: MessageParam[] = [{ role: "user", content: userContent }];

  let toolCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let iters = 0;
  let stopReason: string | null = null;

  const ant = getClient();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    iters++;
    const stream = ant.messages.stream({
      model: config.claudeModel,
      max_tokens: MAX_TOKENS_PER_TURN,
      system,
      tools: CHAT_TOOLS,
      messages,
    });

    if (callbacks) {
      stream.on("text", (delta) => {
        if (delta) callbacks.onText(delta);
      });
    }

    const finalMsg = await stream.finalMessage();

    inputTokens += finalMsg.usage?.input_tokens ?? 0;
    outputTokens += finalMsg.usage?.output_tokens ?? 0;
    cacheReadTokens += finalMsg.usage?.cache_read_input_tokens ?? 0;
    cacheCreationTokens += finalMsg.usage?.cache_creation_input_tokens ?? 0;
    stopReason = finalMsg.stop_reason;

    messages.push({ role: "assistant", content: finalMsg.content });

    if (finalMsg.stop_reason !== "tool_use") break;

    // 收集所有 tool_use blocks 并执行
    const toolResults: ToolResultBlockParam[] = [];
    for (const block of finalMsg.content) {
      if (block.type !== "tool_use") continue;
      // Anthropic 服务端 web_search 由服务器端执行 + 在 finalMsg 里回灌结果，我们这里跳过
      if (block.name === "web_search") continue;
      toolCount++;
      const input = (block.input ?? {}) as Record<string, unknown>;
      callbacks?.onToolUse(formatToolLine(block.name, input));
      const result = await executeTool(block.name, block.input);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.content,
        is_error: result.is_error,
      });
    }

    if (!toolResults.length) break; // 只有服务端工具，无客户端要执行

    messages.push({ role: "user", content: toolResults });
  }

  if (iters >= MAX_ITERATIONS && stopReason === "tool_use") {
    log.warn(`chat ch=${chShort} 达到 MAX_ITERATIONS=${MAX_ITERATIONS}，强制终止 tool loop`);
  }

  // 拼最终文本回复
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  let result = "";
  if (lastAssistant && Array.isArray(lastAssistant.content)) {
    result = lastAssistant.content
      .filter((b): b is { type: "text"; text: string } & Record<string, unknown> => (b as { type: string }).type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }
  if (!result) result = "[无文字回复]";

  log.info(
    `✓ chat ch=${chShort} ${Date.now() - startedAt}ms iters=${iters} ` +
    `tools=${toolCount} reply.len=${result.length} ` +
    `tok in=${inputTokens} out=${outputTokens} cacheR=${cacheReadTokens} cacheW=${cacheCreationTokens}`
  );

  addChatMessage(channelId, userId, "assistant", result);

  extractMemories(prompt, result).catch((err) => {
    log.error("Background memory extraction error:", err);
  });

  return result;
}

function formatToolLine(name: string, input: Record<string, unknown>): string {
  // 新 chat 工具（snake_case）
  if (name === "bash") return `⚡ **bash** \`${truncate(String(input.command ?? ""), 100)}\``;
  if (name === "read_file") return `📖 **read_file** \`${shortenPath(String(input.path ?? ""))}\``;
  if (name === "web_fetch") return `🌐 **web_fetch** ${truncate(String(input.url ?? ""), 100)}`;
  if (name === "web_search") return `🔍 **web_search** ${truncate(String(input.query ?? ""), 100)}`;
  // 兜底（不应触发）
  return `🔧 **${name}** ${truncate(String(Object.values(input)[0] ?? ""), 80)}`;
}

function shortenPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~");
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\n/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

function buildHistoryPrompt(rows: Array<{ role: string; content: string }>): string {
  if (!rows.length) return "";
  const recent = rows.slice(-HISTORY_LIMIT * 2);
  const lines = recent.map((r) => `${r.role}: ${r.content}`);
  return `<conversation_history>\n${lines.join("\n")}\n</conversation_history>`;
}

export const __testables = { formatToolLine, buildHistoryPrompt, IDENTITY_LINE };

async function chatWithCodex(
  system: string,
  prompt: string,
  attachmentCodexInputs?: CodexInputEntry[],
  callbacks?: ChatCallbacks,
): Promise<{ reply: string; tokensSummary?: string; toolCount: number }> {
  const codex = getCodexClient();
  const thread = codex.startThread(codexThreadOptions("chat", config.defaultCwd));
  const ctrl = new AbortController();
  const timeoutCtrl = withCodexTimeout(ctrl.signal, config.codex.timeoutMs);
  const fullPrompt = [
    system,
    "你正在处理 Discord 轻量聊天。默认直接回答；只有在需要确认本地文件、运行只读命令或搜索资料时才使用工具。用中文回复。",
    `<user_message>\n${prompt}\n</user_message>`,
  ].filter(Boolean).join("\n\n");

  const { events } = await thread.runStreamed(
    codexInput(fullPrompt, attachmentCodexInputs),
    { signal: timeoutCtrl.signal },
  );

  let reply = "";
  let tokensSummary: string | undefined;
  let toolCount = 0;
  let lastToolLine = "";

  for await (const event of events) {
    switch (event.type) {
      case "turn.completed":
        tokensSummary = formatCodexUsage(event.usage);
        break;
      case "turn.failed":
        throw new Error(event.error.message);
      case "error":
        throw new Error(event.message);
      case "item.started":
      case "item.updated":
      case "item.completed":
        if (event.item.type === "agent_message") {
          reply = event.item.text;
          callbacks?.onText(reply);
          break;
        }
        {
          const line = formatCodexItemLine(event.item);
          if (line && line !== lastToolLine) {
            toolCount++;
            lastToolLine = line;
            callbacks?.onToolUse(line);
          }
        }
        break;
    }
  }

  if (!timeoutCtrl.signal.aborted) timeoutCtrl.abort();

  return { reply: reply.trim() || "[无文字回复]", ...(tokensSummary ? { tokensSummary } : {}), toolCount };
}
