import {
  Codex,
  type CodexOptions,
  type ThreadOptions,
  type ThreadItem,
  type UserInput,
} from "@openai/codex-sdk";
import { config } from "../config.js";

export type CodexInputEntry = UserInput;
export type CodexMode = "task" | "chat" | "stage";

let client: Codex | null = null;

export function resetCodexClient(): void {
  client = null;
}

export function getCodexClient(): Codex {
  if (!client) {
    const opts: CodexOptions = {};
    if (config.openaiApiKey) opts.apiKey = config.openaiApiKey;
    if (config.openaiBaseUrl) opts.baseUrl = config.openaiBaseUrl;
    client = new Codex(opts);
  }
  return client;
}

export function codexThreadOptions(mode: CodexMode, cwd?: string): ThreadOptions {
  const opts: ThreadOptions = {
    skipGitRepoCheck: true,
    sandboxMode: mode === "task" ? config.codex.taskSandbox : config.codex.chatSandbox,
    approvalPolicy: config.codex.approvalPolicy,
    modelReasoningEffort: config.codex.reasoningEffort,
    webSearchMode: config.codex.webSearchMode,
    networkAccessEnabled: config.codex.networkAccess,
  };
  if (config.codex.model) opts.model = config.codex.model;
  if (cwd) opts.workingDirectory = cwd;
  return opts;
}

export function withCodexTimeout(signal: AbortSignal, timeoutMs: number): AbortController {
  const ctrl = new AbortController();
  const forwardAbort = () => ctrl.abort(signal.reason);
  if (signal.aborted) {
    forwardAbort();
    return ctrl;
  }
  signal.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(new Error(`Codex timeout after ${timeoutMs}ms`)), timeoutMs);
  timer.unref?.();
  ctrl.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return ctrl;
}

export function formatCodexItemLine(item: ThreadItem): string | undefined {
  switch (item.type) {
    case "command_execution":
      return `💻 terminal: "${item.command.replace(/\s+/g, " ").trim().slice(0, 80)}"`;
    case "file_change": {
      const changes = item.changes.map((c) => `${c.kind}:${c.path}`).join(", ");
      return `📝 files: "${changes.slice(0, 100)}"`;
    }
    case "mcp_tool_call":
      return `🔌 ${item.server}:${item.tool}`;
    case "web_search":
      return `🔍 web_search: "${item.query.slice(0, 80)}"`;
    case "todo_list": {
      const done = item.items.filter((i) => i.completed).length;
      return `📋 todo: ${done}/${item.items.length}`;
    }
    case "error":
      return `❌ error: "${item.message.slice(0, 100)}"`;
    default:
      return undefined;
  }
}

export function codexInput(text: string, attachments?: CodexInputEntry[]): string | CodexInputEntry[] {
  if (!attachments?.length) return text;
  return [{ type: "text", text }, ...attachments];
}
