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
model:
  default_client: openai_compatible
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
    expect(runtime.codex.reasoningEffort).toBe("high");
    expect(runtime.channelDefaults["chat-runtime"]).toEqual({ cwd: tmpDir });
    expect(runtime.smartRouter.defaultMode).toBe("auto");
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
