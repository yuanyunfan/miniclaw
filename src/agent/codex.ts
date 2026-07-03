import {
  Codex,
  type CodexOptions,
  type ThreadOptions,
  type ThreadItem,
  type UserInput,
} from "@openai/codex-sdk";
import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { config } from "../config.js";
import type { AgentTaskManagedContext, AgentTaskRuntimeOverride } from "../runtime/agent-runtime.js";

export type CodexInputEntry = UserInput;
export type CodexMode = "task" | "chat" | "stage";

let client: Codex | null = null;

export type CodexClientOverrides = Pick<CodexOptions, "config" | "env">;

export function resetCodexClient(): void {
  client = null;
}

function isExecutableFile(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && (process.platform === "win32" || (stat.mode & 0o111) !== 0);
  } catch {
    return false;
  }
}

function findCodexOnPath(): string | undefined {
  const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    if (dir.includes("node_modules")) continue;
    const candidate = join(dir, binaryName);
    if (isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}

function resolveCodexPathOverride(): string | undefined {
  if (config.codex.path) return config.codex.path;
  const candidates = [
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    findCodexOnPath(),
  ].filter((path): path is string => Boolean(path));
  return candidates.find((path) => existsSync(path) && isExecutableFile(path));
}

function baseCodexOptions(): CodexOptions {
  const opts: CodexOptions = {};
  const codexPathOverride = resolveCodexPathOverride();
  if (codexPathOverride) opts.codexPathOverride = codexPathOverride;
  if (config.openaiApiKey) opts.apiKey = config.openaiApiKey;
  if (config.openaiBaseUrl) opts.baseUrl = config.openaiBaseUrl;
  return opts;
}

export function getCodexClient(overrides?: CodexClientOverrides): Codex {
  if (overrides) {
    return new Codex({
      ...baseCodexOptions(),
      ...(overrides.config ? { config: overrides.config } : {}),
      ...(overrides.env ? { env: overrides.env } : {}),
    });
  }
  if (!client) {
    client = new Codex(baseCodexOptions());
  }
  return client;
}

export function codexThreadOptions(
  mode: CodexMode,
  cwd?: string,
  managedContext?: AgentTaskManagedContext,
  runtimeOverride?: AgentTaskRuntimeOverride,
): ThreadOptions {
  const rolePolicy = managedContext?.rolePolicy;
  const sandboxMode = rolePolicy?.codex.sandboxMode ?? (mode === "task" ? config.codex.taskSandbox : config.codex.chatSandbox);
  const approvalPolicy = rolePolicy?.codex.approvalPolicy ?? config.codex.approvalPolicy;
  const reasoningEffort = runtimeOverride?.reasoningEffort ?? config.codex.reasoningEffort;
  const model = runtimeOverride?.model ?? config.codex.model;
  const opts: ThreadOptions = {
    skipGitRepoCheck: true,
  };
  if (sandboxMode) opts.sandboxMode = sandboxMode;
  if (approvalPolicy) opts.approvalPolicy = approvalPolicy;
  if (reasoningEffort) opts.modelReasoningEffort = reasoningEffort;
  if (config.codex.webSearchMode) opts.webSearchMode = config.codex.webSearchMode;
  if (config.codex.networkAccess !== undefined) opts.networkAccessEnabled = config.codex.networkAccess;
  if (model) opts.model = model;
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
