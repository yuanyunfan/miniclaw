import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages.js";
import { config } from "../config.js";
import { addChatMessage, getChatHistory } from "../store/db.js";
import { buildMemoryPrompt } from "../memory/inject.js";
import { extractMemories } from "../memory/extract.js";
import { createLogger } from "../lib/log.js";

const log = createLogger("chat");

export interface ChatCallbacks {
  onToolUse: (display: string) => void;
  onText: (text: string) => void;
}

export async function chat(
  channelId: string,
  userId: string,
  prompt: string,
  attachmentBlocks?: ContentBlockParam[],
  callbacks?: ChatCallbacks,
): Promise<string> {
  // chat_history 只存文字摘要，不存 base64/URL（避免表膨胀 + 续话不重传附件是设计取舍）
  addChatMessage(channelId, userId, "user", prompt);

  const history = getChatHistory(channelId, 30).reverse();
  const historyBlock = buildHistoryPrompt(history.slice(0, -1));
  const memoryBlock = buildMemoryPrompt();

  const identityLine = "你是 MiniClaw，一个简洁高效的 AI 助手，通过 Discord 与用户沟通。回复时始终以 MiniClaw 的身份自居，不要说自己是 Claude 或 Claude Code。用中文回复用户。";
  const appendParts = [identityLine, memoryBlock].filter(Boolean);

  const fullPrompt = historyBlock ? `${historyBlock}\n\n${prompt}` : prompt;

  let result = "";

  const hasAttachments = !!(attachmentBlocks && attachmentBlocks.length);
  const promptParam: string | AsyncIterable<{
    type: "user";
    message: { role: "user"; content: ContentBlockParam[] };
    parent_tool_use_id: null;
  }> = hasAttachments
    ? (async function* () {
        yield {
          type: "user" as const,
          parent_tool_use_id: null,
          message: {
            role: "user" as const,
            content: [
              ...attachmentBlocks!,
              { type: "text" as const, text: fullPrompt },
            ],
          },
        };
      })()
    : fullPrompt;

  const q = query({
    prompt: promptParam,
    options: {
      model: config.model,
      cwd: config.defaultCwd,
      permissionMode: "acceptEdits",
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: appendParts.join("\n\n"),
      },
      allowedTools: [
        "Read", "Bash", "Glob", "WebSearch", "WebFetch", "Agent",
      ],
      ...(config.defaultMaxTurns !== undefined ? { maxTurns: config.defaultMaxTurns } : {}),
      ...(config.defaultBudgetUsd !== undefined ? { maxBudgetUsd: config.defaultBudgetUsd } : {}),
    },
  });

  for await (const msg of q) {
    if (msg.type === "assistant" && callbacks) {
      for (const block of msg.message.content) {
        if (block.type === "tool_use") {
          const raw = block.input;
          const input = raw && typeof raw === "object" && !Array.isArray(raw)
            ? raw as Record<string, unknown>
            : {};
          const line = formatToolLine(block.name, input);
          if (line) callbacks.onToolUse(line);
        } else if (block.type === "text" && block.text.trim()) {
          callbacks.onText(block.text);
        }
      }
    }

    if (msg.type === "result") {
      result = msg.subtype === "success"
        ? msg.result
        : ("errors" in msg ? msg.errors.join("\n") : "执行出错");
    }
  }

  if (!result) result = "[无结果]";

  addChatMessage(channelId, userId, "assistant", result);

  extractMemories(prompt, result).catch((err) => {
    log.error("Background memory extraction error:", err);
  });

  return result;
}

function formatToolLine(name: string, input: Record<string, unknown>): string | null {
  if (name === "Bash") {
    const cmd = String(input.command ?? "");
    if (cmd.includes(".claude/projects/") || cmd.includes("tool-results/")) return null;
    return `⚡ **Bash** \`${truncate(cmd, 100)}\``;
  }
  if (name === "Read") return `📖 **Read** \`${shortenPath(String(input.file_path ?? ""))}\``;
  if (name === "Write") return `📝 **Write** \`${shortenPath(String(input.file_path ?? ""))}\``;
  if (name === "Edit") return `✏️ **Edit** \`${shortenPath(String(input.file_path ?? ""))}\``;
  if (name === "Glob") return `🔍 **Glob** \`${String(input.pattern ?? "")}\``;
  if (name === "WebSearch") return `🌐 **WebSearch** ${truncate(String(input.query ?? ""), 100)}`;
  if (name === "WebFetch") return `🌐 **WebFetch** ${truncate(String(input.url ?? ""), 100)}`;
  if (name === "Agent") return `🤖 **Agent** ${truncate(String(input.description ?? input.prompt ?? ""), 80)}`;

  if (name.startsWith("mcp__")) {
    const parts = name.split("__");
    const server = parts[1] ?? "mcp";
    const method = parts.slice(2).join(".");
    const args = extractMcpSummary(input);
    return `🔌 **${server}**: ${method}${args ? ` — ${args}` : ""}`;
  }

  return `🔧 **${name}** ${truncate(String(Object.values(input)[0] ?? ""), 80)}`;
}

function extractMcpSummary(input: Record<string, unknown>): string {
  const keys = ["query", "url", "repo", "owner", "ticker", "topic", "keywords", "companyName", "paper_id"];
  const parts: string[] = [];
  for (const k of keys) {
    if (input[k]) parts.push(truncate(String(input[k]), 60));
  }
  return parts.join(", ");
}

function shortenPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~");
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\n/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

const HISTORY_LIMIT = 15;

function buildHistoryPrompt(rows: Array<{ role: string; content: string }>): string {
  if (!rows.length) return "";
  const recent = rows.slice(-HISTORY_LIMIT * 2);
  const lines = recent.map((r) => `${r.role}: ${r.content}`);
  return `<conversation_history>\n${lines.join("\n")}\n</conversation_history>`;
}
