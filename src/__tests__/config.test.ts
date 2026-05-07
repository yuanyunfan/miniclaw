import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ENV_KEYS = [
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_GUILD_ID",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "MINICLAW_CONFIG",
  "MINICLAW_AGENT_PROVIDER",
  "MINICLAW_ALLOWED_USER_ID",
  "MINICLAW_DEFAULT_CWD",
  "MINICLAW_MAX_CONCURRENT_TASKS",
  "MINICLAW_DEFAULT_BUDGET_USD",
  "MINICLAW_DEFAULT_MAX_TURNS",
  "MINICLAW_CHAT_TIMEOUT_MS",
  "MINICLAW_ATTACHMENT_TIMEOUT_MS",
  "MINICLAW_REGISTER_COMMANDS_ON_START",
  "MINICLAW_CLAUDE_MODEL",
  "MINICLAW_MODEL",
  "MINICLAW_CLAUDE_SETTING_SOURCES",
  "MINICLAW_CLAUDE_DISABLE_HOOKS",
  "MINICLAW_CODEX_MODEL",
  "MINICLAW_CODEX_REASONING_EFFORT",
  "MINICLAW_CODEX_TASK_SANDBOX",
  "MINICLAW_CODEX_CHAT_SANDBOX",
  "MINICLAW_CODEX_APPROVAL_POLICY",
  "MINICLAW_CODEX_WEB_SEARCH",
  "MINICLAW_CODEX_TIMEOUT_MS",
  "MINICLAW_CODEX_NETWORK_ACCESS",
  "MINICLAW_AUTO_REPLY_CHANNELS",
  "MINICLAW_TASK_CHANNELS",
  "MINICLAW_MCP_CONFIG",
  "MINICLAW_MCP_ALLOWLIST",
  "MINICLAW_DB_PATH",
  "MINICLAW_MAX_ATTACHMENT_MB",
  "MINICLAW_MAX_ATTACHMENTS",
] as const;

let tmpDir: string;
let previousEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.resetModules();
  tmpDir = mkdtempSync(join(tmpdir(), "miniclaw-config-"));
  previousEnv = {};
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key];
    process.env[key] = "";
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = previousEnv[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  rmSync(tmpDir, { recursive: true, force: true });
  vi.resetModules();
});

describe("config", () => {
  it("loads hierarchical yaml config", async () => {
    const mcpConfig = join(tmpDir, "claude.json");
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
routing:
  auto_reply_channels:
    - "chat-yaml"
  task_channels:
    - "task-yaml"
agent:
  provider: codex
  default_cwd: "${tmpDir}"
  max_concurrent_tasks: 4
  budget_usd: unlimited
  max_turns: 0
  chat_timeout_ms: 1000
  attachment_timeout_ms: 2000
  register_commands_on_start: true
claude:
  model: claude-test
  setting_sources: [user, local]
  disable_hooks: false
codex:
  model: inherit
  reasoning_effort: inherit
  sandbox:
    task: inherit
    chat: read-only
  approval_policy: inherit
  web_search: cached
  timeout_ms: 3000
  network_access: inherit
mcp:
  config: "${mcpConfig}"
  allowlist: [exa, context7]
storage:
  db_path: "${join(tmpDir, "data.db")}"
attachments:
  max_mb: 16
  max_count: 3
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.DISCORD_TOKEN = "token-env";

    const { config } = await import("../config.js");

    expect(config.configFile).toEqual({ path: cfg, loaded: true });
    expect(config.discord.clientId).toBe("client-yaml");
    expect(config.allowedUserId).toBe("user-yaml");
    expect(config.agentProvider).toBe("codex");
    expect(config.defaultCwd).toBe(tmpDir);
    expect(config.defaultBudgetUsd).toBeUndefined();
    expect(config.defaultMaxTurns).toBeUndefined();
    expect(config.codex.model).toBeUndefined();
    expect(config.codex.reasoningEffort).toBeUndefined();
    expect(config.codex.taskSandbox).toBeUndefined();
    expect(config.codex.chatSandbox).toBe("read-only");
    expect(config.codex.networkAccess).toBeUndefined();
    expect(config.mcp).toEqual({ configPath: mcpConfig, allowlist: ["exa", "context7"] });
    expect(config.taskChannelIds).toEqual(["task-yaml"]);
    expect(config.maxAttachments).toBe(3);
  });

  it("keeps legacy env keys as overrides and ignores blank env values", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
routing:
  task_channels: ["task-yaml"]
agent:
  provider: claude
  default_cwd: "${tmpDir}"
claude:
  model: claude-yaml
codex:
  model: yaml-model
mcp:
  allowlist: [exa]
storage:
  db_path: "${join(tmpDir, "data.db")}"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.DISCORD_TOKEN = "token-env";
    process.env.MINICLAW_AGENT_PROVIDER = "codex";
    process.env.MINICLAW_ALLOWED_USER_ID = "user-env";
    process.env.MINICLAW_CODEX_MODEL = "env-model";
    process.env.MINICLAW_MCP_ALLOWLIST = "*";
    process.env.MINICLAW_TASK_CHANNELS = "";

    const { config } = await import("../config.js");

    expect(config.agentProvider).toBe("codex");
    expect(config.allowedUserId).toBe("user-env");
    expect(config.codex.model).toBe("env-model");
    expect(config.mcp.allowlist).toEqual(["*"]);
    expect(config.taskChannelIds).toEqual(["task-yaml"]);
  });

  it("preserves legacy blank budget and turn env values as unlimited", async () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "user-yaml"
agent:
  provider: codex
  default_cwd: "${tmpDir}"
  budget_usd: 2
  max_turns: 8
storage:
  db_path: "${join(tmpDir, "data.db")}"
`);
    process.env.MINICLAW_CONFIG = cfg;
    process.env.DISCORD_TOKEN = "token-env";
    process.env.MINICLAW_DEFAULT_BUDGET_USD = "";
    process.env.MINICLAW_DEFAULT_MAX_TURNS = "";

    const { config } = await import("../config.js");

    expect(config.defaultBudgetUsd).toBeUndefined();
    expect(config.defaultMaxTurns).toBeUndefined();
  });
});
