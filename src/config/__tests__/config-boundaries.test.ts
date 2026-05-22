import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createConfigReader } from "../env.js";
import { assertE2eIsolation } from "../e2e-guard.js";
import { loadRuntimeConfigSource, loadYamlConfig } from "../load.js";
import { channelDefaults, resolveHome } from "../resolve.js";
import { createRuntimeConfig, deepFreeze } from "../runtime.js";
import { parseRawConfigObject } from "../schema.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "miniclaw-config-boundary-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("config load boundary", () => {
  it("loads explicit YAML through the raw object schema", () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, "discord:\n  client_id: client-yaml\n");

    const source = loadRuntimeConfigSource({ MINICLAW_CONFIG: cfg } as NodeJS.ProcessEnv);

    expect(source).toMatchObject({
      path: cfg,
      configuredPath: cfg,
      explicitPath: true,
      loaded: true,
      data: { discord: { client_id: "client-yaml" } },
    });
  });

  it("fails missing explicit config files but allows missing default config references", () => {
    const missing = join(tmpDir, "missing.yaml");

    expect(() => loadYamlConfig(missing, true, missing)).toThrow(/MINICLAW_CONFIG points to a missing file/);
    expect(loadYamlConfig(missing, true, "~/.miniclaw/config.yaml")).toEqual({ data: {}, loaded: false });
  });

  it("rejects non-object YAML at the schema boundary", () => {
    expect(() => parseRawConfigObject(["not", "an", "object"], join(tmpDir, "config.yaml"))).toThrow(
      /MiniClaw config must be a YAML object/
    );
  });
});

describe("config env and resolve boundaries", () => {
  it("preserves env > YAML precedence while ignoring blank env overrides for normal fields", () => {
    const reader = createConfigReader(
      {
        routing: { task_channels: ["task-yaml"] },
        agent: { provider: "claude", budget_usd: 2, max_turns: 8 },
      },
      {
        MINICLAW_AGENT_PROVIDER: "codex",
        MINICLAW_TASK_CHANNELS: "",
        MINICLAW_DEFAULT_BUDGET_USD: "",
      } as NodeJS.ProcessEnv
    );

    expect(reader.oneOf(["agent", "provider"], "MINICLAW_AGENT_PROVIDER", "claude", ["claude", "codex"])).toBe("codex");
    expect(reader.stringArray(["routing", "task_channels"], "MINICLAW_TASK_CHANNELS")).toEqual(["task-yaml"]);
    expect(reader.numberOrUnlimited(["agent", "budget_usd"], "MINICLAW_DEFAULT_BUDGET_USD", 1)).toBeUndefined();
    expect(reader.numberOrUnlimited(["agent", "max_turns"], "MINICLAW_DEFAULT_MAX_TURNS", 30)).toBe(8);
  });

  it("resolves home paths and channel default cwd values outside the singleton runtime", () => {
    const reader = createConfigReader({
      routing: {
        channel_defaults: {
          "task-channel": { cwd: tmpDir },
          "home-channel": { cwd: "~/ProjectRepo" },
        },
      },
    });

    expect(resolveHome("~/ProjectRepo")).toBe(join(homedir(), "ProjectRepo"));
    expect(channelDefaults(reader, ["routing", "channel_defaults"], [])).toEqual({
      "task-channel": { cwd: tmpDir },
      "home-channel": { cwd: join(homedir(), "ProjectRepo") },
    });
  });
});

describe("config runtime boundary", () => {
  it("composes domain builders into a deeply frozen runtime config without importing the singleton", () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
discord:
  client_id: client-runtime
  guild_id: guild-runtime
  allowed_user_id: user-runtime
routing:
  auto_reply_channels: ["chat-runtime"]
  channel_defaults:
    "chat-runtime":
      cwd: "${tmpDir}"
  smart_router:
    default_mode: auto
agent:
  provider: codex
  default_cwd: "${tmpDir}"
runtime:
  default_agent: claude
agent_run_manager:
  auto_enabled: true
  complexity_min_score: 5
  max_turns: 9
  model_routing:
    enabled: true
    defaults:
      provider: codex
    roles:
      planner:
        model: gpt-planner
        reasoning_effort: high
      generator:
        model: gpt-generator
        reasoning_effort: medium
      evaluator:
        provider: inherit
        model: inherit
    escalation:
      enabled: true
      roles: [generator]
      provider: codex
      model: gpt-escalated
      reasoning_effort: high
      max_attempts: 2
  acp:
    enabled: true
    host: 127.0.0.1
    port: 0
    token: local-acp-token
    max_payload_bytes: 12345
    rate_limit_window_ms: 1000
    rate_limit_max_requests: 7
    trace_export_enabled: true
    trace_max_events: 11
    trace_max_bytes: 22222
model:
  default_client: openai_compatible
im:
  transports:
    feishu:
      enabled: true
      webhook_url: "https://open.feishu.cn/open-apis/bot/v2/hook/test"
    weixin:
      enabled: true
      poll_enabled: true
      state_dir: "${join(tmpDir, "weixin-state")}"
      default_account_id: "acct-im-bot"
      allow_from: ["owner@im.wechat"]
      task_bridge_channel_id: "1000000000000000001"
  routes:
    ops:
      targets:
        - transport: feishu
          target: default
        - transport: weixin
          target: "owner@im.wechat"
          account_id: "acct-im-bot"
          context_token: "ctx-token"
codex:
  reasoning_effort: high
storage:
  db_path: "${join(tmpDir, "runtime.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
doctor:
  summary_channel_name: runtime-auto-improve
attachments:
  max_count: 2
`);
    const env = {
      MINICLAW_CONFIG: cfg,
      DISCORD_TOKEN: "token-runtime",
      OPENAI_BASE_URL: "https://openai.env.example/v1",
    } as NodeJS.ProcessEnv;

    const runtime = createRuntimeConfig(env);

    expect(runtime.configFile).toEqual({ path: cfg, loaded: true });
    expect(runtime.discord.clientId).toBe("client-runtime");
    expect(runtime.agentProvider).toBe("codex");
    expect(runtime.runtime.defaultAgent).toBe("claude");
    expect(runtime.modelClient.defaultClient).toBe("openai_compatible");
    expect(runtime.smartRouter.llmClassifier.provider).toBe("openai_compatible");
    expect(runtime.im.routes.ops).toEqual({
      targets: [
        { transport: "feishu", target: "default" },
        { transport: "weixin", target: "owner@im.wechat", accountId: "acct-im-bot", contextToken: "ctx-token" },
      ],
    });
    expect(runtime.im.transports.feishu.webhookUrl).toBe("https://open.feishu.cn/open-apis/bot/v2/hook/test");
    expect(runtime.im.transports.weixin).toEqual({
      enabled: true,
      pollEnabled: true,
      stateDir: join(tmpDir, "weixin-state"),
      defaultAccountId: "acct-im-bot",
      allowedUserIds: ["owner@im.wechat"],
      taskBridgeChannelId: "1000000000000000001",
    });
    expect(runtime.codex.reasoningEffort).toBe("high");
    expect(runtime.channelDefaults["chat-runtime"]).toEqual({ cwd: tmpDir });
    expect(runtime.smartRouter.defaultMode).toBe("auto");
    expect(runtime.agentRunManager).toMatchObject({
      enabled: false,
      autoEnabled: true,
      complexityMinScore: 5,
      acp: {
        enabled: true,
        host: "127.0.0.1",
        port: 0,
        token: "local-acp-token",
        maxPayloadBytes: 12345,
        rateLimitWindowMs: 1000,
        rateLimitMaxRequests: 7,
        traceExportEnabled: true,
        traceMaxEvents: 11,
        traceMaxBytes: 22222,
      },
      policy: expect.objectContaining({ maxTurns: 9 }),
      modelRouting: {
        enabled: true,
        defaults: { provider: "codex" },
        roles: expect.objectContaining({
          planner: { model: "gpt-planner", reasoningEffort: "high" },
          generator: { model: "gpt-generator", reasoningEffort: "medium" },
          evaluator: {},
        }),
        escalation: {
          enabled: true,
          roles: ["generator"],
          override: { provider: "codex", model: "gpt-escalated", reasoningEffort: "high" },
          maxAttempts: 2,
        },
      },
    });
    expect(runtime.doctor.summaryChannelName).toBe("runtime-auto-improve");
    expect(runtime.maxAttachments).toBe(2);
    expect(runtime.openaiBaseUrl).toBe("https://openai.env.example/v1");
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime.codex)).toBe(true);
    expect(Object.isFrozen(runtime.doctor)).toBe(true);
    expect(() => {
      (runtime as { doctor: { enabled: boolean } }).doctor.enabled = false;
    }).toThrow(TypeError);
  });

  it("deepFreeze recursively freezes nested arrays and objects", () => {
    const frozen = deepFreeze({ items: [{ value: "a" }] });

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.items)).toBe(true);
    expect(Object.isFrozen(frozen.items[0])).toBe(true);
    expect(() => {
      (frozen.items as Array<{ value: string }>).push({ value: "b" });
    }).toThrow(TypeError);
  });

  it("reads Agent Run Manager model routing env overrides", () => {
    const cfg = join(tmpDir, "config-env.yaml");
    writeFileSync(cfg, `
discord:
  client_id: client-env
  guild_id: guild-env
  allowed_user_id: user-env
agent:
  provider: codex
  default_cwd: "${tmpDir}"
storage:
  db_path: "${join(tmpDir, "env.db")}"
  memory_path: "${join(tmpDir, "ENV_MEMORY.md")}"
`);
    const runtime = createRuntimeConfig({
      MINICLAW_CONFIG: cfg,
      DISCORD_TOKEN: "token-env",
      MINICLAW_AGENT_RUN_MANAGER_MODEL_ROUTING_ENABLED: "true",
      MINICLAW_AGENT_RUN_MANAGER_GENERATOR_PROVIDER: "codex",
      MINICLAW_AGENT_RUN_MANAGER_GENERATOR_MODEL: "gpt-generator-env",
      MINICLAW_AGENT_RUN_MANAGER_GENERATOR_REASONING_EFFORT: "low",
      MINICLAW_AGENT_RUN_MANAGER_ESCALATION_ENABLED: "true",
      MINICLAW_AGENT_RUN_MANAGER_ESCALATION_MODEL: "gpt-escalated-env",
    } as NodeJS.ProcessEnv);

    expect(runtime.agentRunManager.modelRouting).toMatchObject({
      enabled: true,
      roles: {
        generator: {
          provider: "codex",
          model: "gpt-generator-env",
          reasoningEffort: "low",
        },
      },
      escalation: {
        enabled: true,
        roles: ["generator"],
        override: { model: "gpt-escalated-env" },
        maxAttempts: 1,
      },
    });
  });

  it("allows Weixin-only runtime config without Discord credentials when Discord transport is disabled", () => {
    const cfg = join(tmpDir, "config.yaml");
    writeFileSync(cfg, `
im:
  transports:
    discord:
      enabled: false
    weixin:
      enabled: true
      poll_enabled: true
      state_dir: "${join(tmpDir, "weixin-state")}"
      default_account_id: "acct-im-bot"
      allow_from: ["owner@im.wechat"]
agent:
  provider: codex
  default_cwd: "${tmpDir}"
storage:
  db_path: "${join(tmpDir, "runtime.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
`);

    const runtime = createRuntimeConfig({ MINICLAW_CONFIG: cfg } as NodeJS.ProcessEnv);

    expect(runtime.im.transports.discord.enabled).toBe(false);
    expect(runtime.discord).toEqual({ token: "", clientId: "", guildId: "" });
    expect(runtime.allowedUserId).toBe("");
    expect(runtime.im.transports.weixin).toMatchObject({
      enabled: true,
      pollEnabled: true,
      defaultAccountId: "acct-im-bot",
      allowedUserIds: ["owner@im.wechat"],
    });
  });
});

describe("config E2E guard boundary", () => {
  it("validates E2E isolation without importing the runtime config singleton", () => {
    const cfg = join(tmpDir, "config.yaml");
    const dbPath = join(tmpDir, "data.db");
    const memoryPath = join(tmpDir, "MEMORY.md");

    expect(() =>
      assertE2eIsolation({
        e2eMode: true,
        configuredConfigPath: cfg,
        configPath: cfg,
        senderUserIds: ["sender-a"],
        disableScheduler: true,
        fakeAgent: true,
        dbPath,
        memoryPath,
        defaultCwd: tmpDir,
        channelDefaults: { "task-channel": { cwd: join(tmpDir, "task") } },
        tempRoot: tmpdir(),
      })
    ).not.toThrow();
  });

  it("fails closed for fake agent outside E2E mode and non-temp E2E paths", () => {
    expect(() =>
      assertE2eIsolation({
        e2eMode: false,
        fakeAgent: true,
        configPath: join(tmpDir, "config.yaml"),
        senderUserIds: [],
        disableScheduler: false,
        dbPath: join(tmpDir, "data.db"),
        memoryPath: join(tmpDir, "MEMORY.md"),
        defaultCwd: tmpDir,
        channelDefaults: {},
      })
    ).toThrow(/MINICLAW_E2E_FAKE_AGENT requires MINICLAW_E2E_MODE=true/);

    expect(() =>
      assertE2eIsolation({
        e2eMode: true,
        configuredConfigPath: join(tmpDir, "config.yaml"),
        configPath: join(tmpDir, "config.yaml"),
        senderUserIds: ["sender-a"],
        disableScheduler: true,
        fakeAgent: true,
        dbPath: join(tmpDir, "data.db"),
        memoryPath: join(tmpDir, "MEMORY.md"),
        defaultCwd: process.cwd(),
        channelDefaults: {},
        tempRoot: tmpdir(),
      })
    ).toThrow(/MINICLAW_DEFAULT_CWD/);
  });
});
