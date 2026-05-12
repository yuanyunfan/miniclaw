import type { ConfigReader } from "../env.js";
import { resolveHome } from "../resolve.js";

export function buildMcpRuntimeConfig(reader: ConfigReader) {
  return {
    configPath: resolveHome(reader.requiredString(["mcp", "config"], "MINICLAW_MCP_CONFIG", "~/.claude.json")),
    allowlist: reader.stringArray(["mcp", "allowlist"], "MINICLAW_MCP_ALLOWLIST", ["exa", "context7"]),
  } as const;
}
