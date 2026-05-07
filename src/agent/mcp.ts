import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "../lib/log.js";

const log = createLogger("mcp");

export type McpServers = Record<string, McpServerConfig>;

let cache: McpServers | null = null;

function parseAllowlist(raw: string): { names: string[]; allowAll: boolean } {
  const names = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { names, allowAll: names.includes("*") };
}

function resolveHome(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

export function resetMcpCache(): void {
  cache = null;
}

export function loadMcpServers(): McpServers {
  if (cache) return cache;

  const configPath = resolveHome(process.env.MINICLAW_MCP_CONFIG ?? join(homedir(), ".claude.json"));
  const allowlist = parseAllowlist(process.env.MINICLAW_MCP_ALLOWLIST ?? "exa,context7");

  if (!existsSync(configPath)) {
    log.warn(`配置文件不存在: ${configPath}，跳过 MCP 接入`);
    cache = {};
    return cache;
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (err) {
    log.warn(`无法读取 ${configPath}:`, err);
    cache = {};
    return cache;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn(`解析 ${configPath} JSON 失败:`, err);
    cache = {};
    return cache;
  }

  const all = (parsed as { mcpServers?: Record<string, McpServerConfig> })?.mcpServers ?? {};
  const filtered: McpServers = {};
  if (allowlist.allowAll) {
    Object.assign(filtered, all);
  } else {
    for (const name of allowlist.names) {
      if (all[name]) filtered[name] = all[name];
      else log.warn(`allowlist 中的 ${name} 在 ${configPath} 未找到`);
    }
  }

  log.info(`加载 ${Object.keys(filtered).length} 个 MCP server: ${Object.keys(filtered).join(", ") || "(无)"}`);
  cache = filtered;
  return cache;
}
