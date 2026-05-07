import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { config } from "../config.js";
import { loadMcpServers } from "./mcp.js";

export interface AgentRuntimeSummary {
  provider: string;
  model: string;
  defaultCwd: string;
  codex: {
    model: string;
    reasoningEffort: string;
    taskSandbox: string;
    chatSandbox: string;
    approvalPolicy: string;
    webSearchMode: string;
    networkAccess: string;
    mcpServers: string[];
    skills: string[];
  };
  claude: {
    model: string;
    settingSources: string[];
    hooks: string;
    mcpServers: string[];
    skills: string[];
    agents: string[];
  };
  miniclaw: {
    skills: string[];
  };
}

function code(v: string): string {
  return `\`${v}\``;
}

function inherited(v: string | boolean | undefined): string {
  if (v === undefined) return "inherit";
  return String(v);
}

function readCodexMcpServerNames(): string[] {
  const path = join(homedir(), ".codex", "config.toml");
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const names = new Set<string>();
  const re = /^\[mcp_servers\.(?:"([^"]+)"|([^\]]+))\]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const name = (m[1] ?? m[2] ?? "").trim();
    if (name) names.add(name);
  }
  return [...names].sort();
}

function listSkillNames(root: string): string[] {
  if (!existsSync(root)) return [];
  const result: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    if (entries.includes("SKILL.md")) {
      result.push(relative(root, dir) || ".");
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const path = join(dir, entry);
      try {
        if (statSync(path).isDirectory()) walk(path, depth + 1);
      } catch {
        // Ignore unreadable entries in diagnostic output.
      }
    }
  };
  walk(root, 0);
  return result.sort();
}

function listMarkdownBasenames(root: string): string[] {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
  } catch {
    return [];
  }
}

function joinNames(values: string[], max = 12): string {
  if (!values.length) return "(none)";
  const head = values.slice(0, max).map(code).join(", ");
  const rest = values.length > max ? `, +${values.length - max} more` : "";
  return `${head}${rest}`;
}

export function getAgentRuntimeSummary(): AgentRuntimeSummary {
  return {
    provider: config.agentProvider,
    model: config.model,
    defaultCwd: config.defaultCwd,
    codex: {
      model: inherited(config.codex.model),
      reasoningEffort: inherited(config.codex.reasoningEffort),
      taskSandbox: inherited(config.codex.taskSandbox),
      chatSandbox: inherited(config.codex.chatSandbox),
      approvalPolicy: inherited(config.codex.approvalPolicy),
      webSearchMode: inherited(config.codex.webSearchMode),
      networkAccess: inherited(config.codex.networkAccess),
      mcpServers: readCodexMcpServerNames(),
      skills: listSkillNames(join(homedir(), ".codex", "skills")),
    },
    claude: {
      model: config.claudeModel,
      settingSources: config.claude.settingSources,
      hooks: config.claude.disableHooks ? "disabled" : "inherited",
      mcpServers: Object.keys(loadMcpServers()).sort(),
      skills: listSkillNames(join(homedir(), ".claude", "skills")),
      agents: listMarkdownBasenames(join(homedir(), ".claude", "agents")),
    },
    miniclaw: {
      skills: listMarkdownBasenames(process.env.MINICLAW_SKILLS_DIR ?? join(homedir(), ".miniclaw", "skills")),
    },
  };
}

export function formatAgentRuntimeSummary(summary = getAgentRuntimeSummary()): string {
  return [
    "**Agent Config**",
    `Provider: ${code(summary.provider)} / Model: ${code(summary.model)}`,
    `Default CWD: ${code(summary.defaultCwd)}`,
    "",
    "**Codex**",
    `model=${code(summary.codex.model)} sandbox(task/chat)=${code(`${summary.codex.taskSandbox}/${summary.codex.chatSandbox}`)}`,
    `approval=${code(summary.codex.approvalPolicy)} reasoning=${code(summary.codex.reasoningEffort)} web=${code(summary.codex.webSearchMode)} network=${code(summary.codex.networkAccess)}`,
    `MCP: ${joinNames(summary.codex.mcpServers)}`,
    `Skills: ${joinNames(summary.codex.skills)}`,
    "",
    "**Claude**",
    `model=${code(summary.claude.model)} settingSources=${code(summary.claude.settingSources.join(",") || "none")} hooks=${code(summary.claude.hooks)}`,
    `MCP loaded by MiniClaw: ${joinNames(summary.claude.mcpServers)}`,
    `Skills: ${joinNames(summary.claude.skills)}`,
    `Agents: ${joinNames(summary.claude.agents)}`,
    "",
    "**MiniClaw Custom**",
    `Skills/Subagents: ${joinNames(summary.miniclaw.skills)}`,
  ].join("\n");
}
