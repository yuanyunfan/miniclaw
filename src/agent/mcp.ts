import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

export type McpServers = Record<string, McpServerConfig>;

let cache: McpServers | null = null;

export function resetMcpCache(): void {
  cache = null;
}

export function loadMcpServers(): McpServers {
  if (cache) return cache;

  const configPath = process.env.MINICLAW_MCP_CONFIG ?? join(homedir(), ".claude.json");
  const allowlist = (process.env.MINICLAW_MCP_ALLOWLIST ?? "exa,context7")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!existsSync(configPath)) {
    console.warn(`[mcp] 配置文件不存在: ${configPath}，跳过 MCP 接入`);
    cache = {};
    return cache;
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (err) {
    console.warn(`[mcp] 无法读取 ${configPath}:`, err);
    cache = {};
    return cache;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[mcp] 解析 ${configPath} JSON 失败:`, err);
    cache = {};
    return cache;
  }

  const all = (parsed as { mcpServers?: Record<string, McpServerConfig> })?.mcpServers ?? {};
  const filtered: McpServers = {};
  for (const name of allowlist) {
    if (all[name]) filtered[name] = all[name];
    else console.warn(`[mcp] allowlist 中的 ${name} 在 ${configPath} 未找到`);
  }

  console.log(`[mcp] 加载 ${Object.keys(filtered).length} 个 MCP server: ${Object.keys(filtered).join(", ") || "(无)"}`);
  cache = filtered;
  return cache;
}
