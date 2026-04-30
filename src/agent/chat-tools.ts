import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute } from "node:path";
import type { Tool, ToolUnion } from "@anthropic-ai/sdk/resources/messages.js";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

const READ_MAX_BYTES = 1_000_000;
const BASH_OUTPUT_MAX = 50_000;
const BASH_DEFAULT_TIMEOUT_MS = 30_000;
const BASH_MAX_TIMEOUT_MS = 120_000;
const FETCH_OUTPUT_MAX = 100_000;
const FETCH_TIMEOUT_MS = 15_000;

export interface ToolExecResult {
  content: string;
  is_error: boolean;
}

/**
 * Tool 定义：4 个客户端工具 + 1 个 Anthropic 服务端 web_search。
 * Anthropic 服务端工具用 ToolUnion 类型（含 type 字段），普通客户端工具用 Tool 类型。
 */
export const CHAT_TOOLS: ToolUnion[] = [
  {
    name: "read_file",
    description: "读取本地文件内容（utf8）。仅支持绝对路径，文件大小上限 1MB。超过用 bash 的 head/tail 处理。",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "绝对路径，例如 /Users/yuan/.miniclaw/cron/foo.yaml" },
      },
      required: ["path"],
    },
  } satisfies Tool,
  {
    name: "bash",
    description: `在 ${config.defaultCwd} 执行 shell 命令。用于探查信息（ls / cat / grep / git status 等）。timeout 默认 30s 上限 120s。output 截断到 50KB。不要用于代码修改 —— 那是 /task 的事。`,
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "完整 shell 命令" },
        timeout_ms: { type: "number", description: "可选，超时毫秒数（30000-120000）" },
      },
      required: ["command"],
    },
  } satisfies Tool,
  // Anthropic 服务端工具：web_search 需要 Anthropic 直连原生 API；raven/Copilot 代理不支持，故禁用
  // 留 web_fetch 作为唯一网络出口；后续可改成调 Exa MCP HTTP API
  // {
  //   type: "web_search_20250305",
  //   name: "web_search",
  //   max_uses: 5,
  // } as ToolUnion,
  {
    name: "web_fetch",
    description: "抓取一个 http/https URL 的文本内容（截断到 100KB）。不支持 file://、内网地址、redirect 到内网。",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "完整的 http(s) URL" },
      },
      required: ["url"],
    },
  } satisfies Tool,
];

export async function executeTool(name: string, input: unknown): Promise<ToolExecResult> {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "read_file":
        return await execReadFile(String(args.path ?? ""));
      case "bash":
        return await execBash(String(args.command ?? ""), typeof args.timeout_ms === "number" ? args.timeout_ms : undefined);
      case "web_fetch":
        return await execWebFetch(String(args.url ?? ""));
      default:
        return { content: `Unknown tool: ${name}`, is_error: true };
    }
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), is_error: true };
  }
}

async function execReadFile(path: string): Promise<ToolExecResult> {
  if (!path) return { content: "path 不能为空", is_error: true };
  if (!isAbsolute(path)) return { content: `path 必须是绝对路径，收到：${path}`, is_error: true };
  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(path);
  } catch (err) {
    return { content: `文件不存在或无法访问：${path}`, is_error: true };
  }
  if (!st.isFile()) return { content: `不是文件：${path}`, is_error: true };
  if (st.size > READ_MAX_BYTES) {
    return { content: `文件过大 (${(st.size / 1024 / 1024).toFixed(2)} MB > 1 MB)，请用 bash head/tail/sed 取需要的部分`, is_error: true };
  }
  const buf = await readFile(path, "utf8");
  return { content: buf, is_error: false };
}

async function execBash(command: string, timeoutMs?: number): Promise<ToolExecResult> {
  if (!command.trim()) return { content: "command 不能为空", is_error: true };
  const denied = validateReadOnlyBash(command);
  if (denied) return { content: `chat bash 拒绝执行：${denied}`, is_error: true };
  const timeout = Math.min(BASH_MAX_TIMEOUT_MS, Math.max(1000, timeoutMs ?? BASH_DEFAULT_TIMEOUT_MS));
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
      cwd: config.defaultCwd,
      timeout,
      maxBuffer: BASH_OUTPUT_MAX * 4,
    });
    let out = stdout || "";
    if (stderr) out += (out ? "\n" : "") + `[stderr]\n${stderr}`;
    if (out.length > BASH_OUTPUT_MAX) {
      out = out.slice(0, BASH_OUTPUT_MAX) + `\n... [output 截断，超过 ${BASH_OUTPUT_MAX} 字节]`;
    }
    return { content: out || "(no output)", is_error: false };
  } catch (err) {
    const e = err as { killed?: boolean; signal?: string; stdout?: string; stderr?: string; message?: string };
    if (e.killed && e.signal === "SIGTERM") {
      return { content: `命令超时 (timeout=${timeout}ms)`, is_error: true };
    }
    const partial = (e.stdout || "") + (e.stderr ? `\n[stderr]\n${e.stderr}` : "");
    const trimmed = partial.length > BASH_OUTPUT_MAX ? partial.slice(0, BASH_OUTPUT_MAX) + "\n... [截断]" : partial;
    return { content: `命令失败: ${e.message ?? "unknown"}\n${trimmed}`, is_error: true };
  }
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fe80:/i,
  /^f[cd][0-9a-f]{2}:/i,
];

function validateReadOnlyBash(command: string): string | null {
  const compact = command.replace(/\s+/g, " ").trim();
  const lower = compact.toLowerCase();
  const denied: Array<{ re: RegExp; reason: string }> = [
    { re: /(^|[^<])>{1,2}|<</, reason: "chat 只允许只读探查，禁止 shell 重定向/ heredoc" },
    { re: /\b(?:rm|mv|cp|chmod|chown|mkdir|rmdir|touch|tee|dd|truncate)\b/, reason: "chat 只允许只读探查，禁止文件写入/删除类命令" },
    { re: /\bsudo\b/, reason: "禁止 sudo" },
    { re: /\bgit\s+(?:push|commit|reset|checkout|switch|clean|rebase|merge|pull)\b/, reason: "chat 禁止修改 git 工作区或远端" },
    { re: /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update|publish|run|exec|dlx)\b/, reason: "chat 禁止包管理器执行/安装；需要执行请用 /task" },
  ];

  for (const d of denied) {
    if (d.re.test(lower)) return `${d.reason}: ${compact.slice(0, 160)}`;
  }
  return null;
}

function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h.endsWith(".")) h = h.slice(0, -1);
  return h;
}

function isPrivateHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return PRIVATE_HOST_PATTERNS.some((re) => re.test(normalized));
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function execWebFetch(rawUrl: string): Promise<ToolExecResult> {
  if (!rawUrl) return { content: "url 不能为空", is_error: true };
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { content: `URL 解析失败：${rawUrl}`, is_error: true };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { content: `仅支持 http/https，收到 ${parsed.protocol}`, is_error: true };
  }
  if (isPrivateHost(parsed.hostname)) {
    return { content: `拒绝抓取内网地址：${parsed.hostname}`, is_error: true };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(parsed.href, {
      headers: { "User-Agent": "MiniClaw/0.4 (Discord bot)" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return { content: `HTTP ${res.status} ${res.statusText}`, is_error: true };
    }
    // 二次校验：跟随 redirect 后的 URL 是否落到内网（res.url 可能为空，回落到原 URL）
    const finalHost = res.url ? safeHostname(res.url) : parsed.hostname;
    if (finalHost && isPrivateHost(finalHost)) {
      return { content: `redirect 到内网地址被拒：${finalHost}`, is_error: true };
    }
    let text = await res.text();
    if (text.length > FETCH_OUTPUT_MAX) {
      text = text.slice(0, FETCH_OUTPUT_MAX) + `\n... [截断，超过 ${FETCH_OUTPUT_MAX} 字节]`;
    }
    return { content: text, is_error: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `抓取失败：${msg}`, is_error: true };
  } finally {
    clearTimeout(timer);
  }
}

export const __testables = { execReadFile, execBash, execWebFetch, isPrivateHost, validateReadOnlyBash };
