import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.js";
import { addChatMessage } from "../store/db.js";

export interface ChatCallbacks {
  onToolUse: (display: string) => void;
  onText: (text: string) => void;
}

export async function chat(
  channelId: string,
  userId: string,
  prompt: string,
  callbacks?: ChatCallbacks,
): Promise<string> {
  addChatMessage(channelId, userId, "user", prompt);

  let result = "";

  const q = query({
    prompt,
    options: {
      model: config.model,
      cwd: config.defaultCwd,
      permissionMode: "acceptEdits",
      allowedTools: [
        "Read", "Bash", "Glob", "WebSearch", "WebFetch", "Agent",
      ],
      maxTurns: config.defaultMaxTurns,
      maxBudgetUsd: config.defaultBudgetUsd,
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
