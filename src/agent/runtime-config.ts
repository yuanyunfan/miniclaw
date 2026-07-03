import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { config } from "../config.js";
import { listPreProviderNames } from "../providers/index.js";
import { loadMcpServers } from "./mcp.js";

export interface AgentRuntimeSummary {
  config: {
    filePath: string;
    fileLoaded: boolean;
    mcpConfigPath: string;
    mcpAllowlist: string[];
  };
  provider: string;
  model: string;
  runtime: {
    defaultAgent: string;
  };
  agentRunManager: {
    modelRoutingEnabled: boolean;
    modelRoutingRoles: string[];
    escalationEnabled: boolean;
    escalationRoles: string[];
  };
  modelClient: {
    defaultClient: string;
    smartRouterClient: string;
  };
  transport: {
    defaultTransport: string;
    implemented: string[];
  };
  dataProviders: {
    preProviders: string[];
  };
  defaultCwd: string;
  codex: {
    cliPath: string;
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
    config: {
      filePath: config.configFile.path,
      fileLoaded: config.configFile.loaded,
      mcpConfigPath: config.mcp.configPath,
      mcpAllowlist: [...config.mcp.allowlist],
    },
    provider: config.agentProvider,
    model: config.model,
    runtime: {
      defaultAgent: config.runtime.defaultAgent,
    },
    agentRunManager: {
      modelRoutingEnabled: config.agentRunManager.modelRouting.enabled,
      modelRoutingRoles: Object.entries(config.agentRunManager.modelRouting.roles)
        .filter(([, override]) => Boolean(
          override.provider ||
          override.model ||
          override.reasoningEffort ||
          override.maxTurns !== undefined ||
          override.budgetUsd !== undefined
        ))
        .map(([role, override]) => `${role}:${override.provider ?? "inherit"}/${override.model ?? "inherit"}`)
        .sort(),
      escalationEnabled: config.agentRunManager.modelRouting.escalation.enabled,
      escalationRoles: [...config.agentRunManager.modelRouting.escalation.roles],
    },
    modelClient: {
      defaultClient: config.modelClient.defaultClient,
      smartRouterClient: config.smartRouter.llmClassifier.provider,
    },
    transport: {
      defaultTransport: config.im.defaultTransport,
      implemented: [
        ...(config.im.transports.discord.enabled ? ["discord"] : []),
        ...(config.im.transports.feishu.enabled ? ["feishu"] : []),
      ],
    },
    dataProviders: {
      preProviders: listPreProviderNames(),
    },
    defaultCwd: config.defaultCwd,
    codex: {
      cliPath: inherited(config.codex.path),
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
    `AgentRuntime: ${code(summary.runtime.defaultAgent)} / Model: ${code(summary.model)}`,
    `Managed model routing: ${summary.agentRunManager.modelRoutingEnabled ? "enabled" : "disabled"} roles=${joinNames(summary.agentRunManager.modelRoutingRoles)}`,
    `Managed escalation: ${summary.agentRunManager.escalationEnabled ? "enabled" : "disabled"} roles=${joinNames(summary.agentRunManager.escalationRoles)}`,
    `Legacy provider alias: ${code(summary.provider)}`,
    `ModelClient: default=${code(summary.modelClient.defaultClient)} smart-router=${code(summary.modelClient.smartRouterClient)}`,
    `IMTransport: default=${code(summary.transport.defaultTransport)} implemented=${joinNames(summary.transport.implemented)}`,
    `Data providers: ${joinNames(summary.dataProviders.preProviders)}`,
    `Config: ${code(summary.config.filePath)} (${summary.config.fileLoaded ? "loaded" : "not found, defaults/env only"})`,
    `Default CWD: ${code(summary.defaultCwd)}`,
    "",
    "**Codex**",
    `cli=${code(summary.codex.cliPath)}`,
    `model=${code(summary.codex.model)} sandbox(task/chat)=${code(`${summary.codex.taskSandbox}/${summary.codex.chatSandbox}`)}`,
    `approval=${code(summary.codex.approvalPolicy)} reasoning=${code(summary.codex.reasoningEffort)} web=${code(summary.codex.webSearchMode)} network=${code(summary.codex.networkAccess)}`,
    `MCP: ${joinNames(summary.codex.mcpServers)}`,
    `Skills: ${joinNames(summary.codex.skills)}`,
    "",
    "**Claude**",
    `model=${code(summary.claude.model)} settingSources=${code(summary.claude.settingSources.join(",") || "none")} hooks=${code(summary.claude.hooks)}`,
    `MCP config=${code(summary.config.mcpConfigPath)} allowlist=${code(summary.config.mcpAllowlist.join(",") || "none")}`,
    `MCP loaded by MiniClaw: ${joinNames(summary.claude.mcpServers)}`,
    `Skills: ${joinNames(summary.claude.skills)}`,
    `Agents: ${joinNames(summary.claude.agents)}`,
    "",
    "**MiniClaw Custom**",
    `Skills/Subagents: ${joinNames(summary.miniclaw.skills)}`,
  ].join("\n");
}
