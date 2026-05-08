#!/usr/bin/env tsx
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  Client,
  Events,
  GatewayIntentBits,
  AttachmentBuilder,
  Partials,
  type Message,
  type TextBasedChannel,
} from "discord.js";
import Database from "better-sqlite3";

interface HarnessConfig {
  runId: string;
  repoRoot: string;
  miniClawToken: string;
  miniClawClientId: string;
  senderToken: string;
  guildId: string;
  chatChannelId: string;
  taskChannelId: string;
  fakeAgent: boolean;
  cases: Set<string>;
  timeoutMs: number;
  keepArtifacts: boolean;
}

interface JsonLogRecord {
  ts?: string;
  level?: string;
  module?: string;
  message?: string;
}

function optionalEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function requiredEnv(key: string, fallbackKey?: string): string {
  const value = optionalEnv(key) ?? (fallbackKey ? optionalEnv(fallbackKey) : undefined);
  if (!value) {
    throw new Error(`Missing ${key}${fallbackKey ? ` or ${fallbackKey}` : ""}`);
  }
  return value;
}

function shellQuoteYaml(value: string): string {
  return JSON.stringify(value);
}

function parseCases(raw: string | undefined): Set<string> {
  const defaults = ["chat", "task", "followup"];
  const values = (raw ? raw.split(",") : defaults).map((v) => v.trim()).filter(Boolean);
  return new Set(values);
}

function loadConfig(): HarnessConfig {
  const repoRoot = process.cwd();
  return {
    runId: optionalEnv("MINICLAW_E2E_RUN_ID") ?? `e2e-${Date.now()}`,
    repoRoot,
    miniClawToken: requiredEnv("MINICLAW_E2E_BOT_TOKEN", "DISCORD_TOKEN"),
    miniClawClientId: requiredEnv("MINICLAW_E2E_CLIENT_ID", "DISCORD_CLIENT_ID"),
    senderToken: requiredEnv("MINICLAW_E2E_SENDER_TOKEN"),
    guildId: requiredEnv("MINICLAW_E2E_GUILD_ID", "DISCORD_GUILD_ID"),
    chatChannelId: requiredEnv("MINICLAW_E2E_CHAT_CHANNEL_ID"),
    taskChannelId: requiredEnv("MINICLAW_E2E_TASK_CHANNEL_ID"),
    fakeAgent: optionalEnv("MINICLAW_E2E_FAKE_AGENT") !== "false",
    cases: parseCases(optionalEnv("MINICLAW_E2E_CASES")),
    timeoutMs: Number(optionalEnv("MINICLAW_E2E_TIMEOUT_MS") ?? "90000"),
    keepArtifacts: optionalEnv("MINICLAW_E2E_KEEP_ARTIFACTS") !== "0",
  };
}

function redact(line: string): string {
  const secrets = [
    optionalEnv("MINICLAW_E2E_BOT_TOKEN"),
    optionalEnv("DISCORD_TOKEN"),
    optionalEnv("MINICLAW_E2E_SENDER_TOKEN"),
    optionalEnv("ANTHROPIC_API_KEY"),
    optionalEnv("OPENAI_API_KEY"),
  ].filter((v): v is string => Boolean(v));
  let out = line;
  for (const secret of secrets) out = out.split(secret).join("[redacted]");
  return out;
}

function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
  });
}

function waitForMessage(
  client: Client,
  label: string,
  timeoutMs: number,
  predicate: (message: Message) => boolean
): Promise<Message> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.off(Events.MessageCreate, onMessage);
      reject(new Error(`Timed out waiting for Discord message: ${label}`));
    }, timeoutMs);
    const onMessage = (message: Message) => {
      if (!predicate(message)) return;
      clearTimeout(timeout);
      client.off(Events.MessageCreate, onMessage);
      resolve(message);
    };
    client.on(Events.MessageCreate, onMessage);
  });
}

async function waitUntil<T>(
  label: string,
  timeoutMs: number,
  fn: () => Promise<T | undefined>
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${String(lastError)}` : ""}`);
}

async function fetchTextChannel(client: Client, channelId: string): Promise<TextBasedChannel> {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error(`Discord channel is not text based: ${channelId}`);
  return channel;
}

function writeMiniClawConfig(root: string, cfg: HarnessConfig, senderUserId: string): { configPath: string; dbPath: string } {
  const cwd = join(root, "cwd");
  const dbPath = join(root, "data.db");
  mkdirSync(cwd, { recursive: true });
  const configPath = join(root, "config.yaml");
  writeFileSync(configPath, `
discord:
  token: ${shellQuoteYaml(cfg.miniClawToken)}
  client_id: ${shellQuoteYaml(cfg.miniClawClientId)}
  guild_id: ${shellQuoteYaml(cfg.guildId)}
  allowed_user_id: ${shellQuoteYaml(senderUserId)}
routing:
  auto_reply_channels:
    - ${shellQuoteYaml(cfg.chatChannelId)}
  task_channels:
    - ${shellQuoteYaml(cfg.taskChannelId)}
  channel_defaults:
    ${shellQuoteYaml(cfg.taskChannelId)}:
      cwd: ${shellQuoteYaml(cwd)}
  smart_router:
    enabled: ${cfg.cases.has("smart-router") ? "true" : "false"}
    default_mode: auto
    min_confirm_confidence: 0.5
    min_auto_confidence: 0.5
    confirm_channels:
      - ${shellQuoteYaml(cfg.chatChannelId)}
    auto_task_channels:
      - ${shellQuoteYaml(cfg.chatChannelId)}
    llm_classifier:
      enabled: false
      only_when_ambiguous: true
agent:
  provider: ${shellQuoteYaml(optionalEnv("MINICLAW_E2E_AGENT_PROVIDER") ?? "codex")}
  default_cwd: ${shellQuoteYaml(cwd)}
  max_concurrent_tasks: 1
  budget_usd: 0.05
  max_turns: 4
storage:
  db_path: ${shellQuoteYaml(dbPath)}
  memory_path: ${shellQuoteYaml(join(root, "MEMORY.md"))}
e2e:
  mode: true
  sender_user_ids:
    - ${shellQuoteYaml(senderUserId)}
  disable_scheduler: true
  fake_agent: ${cfg.fakeAgent ? "true" : "false"}
`, "utf8");
  return { configPath, dbPath };
}

function startMiniClaw(configPath: string, cfg: HarnessConfig, artifactDir: string): {
  child: ChildProcessWithoutNullStreams;
  logs: JsonLogRecord[];
  ready: Promise<void>;
} {
  const logs: JsonLogRecord[] = [];
  const rawLogPath = join(artifactDir, "logs.jsonl");
  const child = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
    cwd: cfg.repoRoot,
    env: {
      ...process.env,
      MINICLAW_CONFIG: configPath,
      MINICLAW_E2E_MODE: "true",
      MINICLAW_E2E_FAKE_AGENT: cfg.fakeAgent ? "true" : "false",
      MINICLAW_DISABLE_SCHEDULER: "true",
      MINICLAW_LOG_FORMAT: "json",
      MINICLAW_LOG_LEVEL: "info",
    },
  });

  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for MiniClaw login")), 45_000);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const rawLine of text.split(/\r?\n/).filter(Boolean)) {
        const line = redact(rawLine);
        writeFileSync(rawLogPath, `${line}\n`, { flag: "a" });
        try {
          const record = JSON.parse(line) as JsonLogRecord;
          logs.push(record);
          if (record.module === "bot" && record.message?.includes("Logged in as")) {
            clearTimeout(timeout);
            resolve();
          }
        } catch {
          logs.push({ message: line });
        }
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`MiniClaw exited before ready: ${code}`));
    });
  });

  return { child, logs, ready };
}

async function runChatCase(client: Client, cfg: HarnessConfig, transcript: string[]): Promise<void> {
  const channel = await fetchTextChannel(client, cfg.chatChannelId);
  const messageWait = waitForMessage(
    client,
    "chat sentinel",
    cfg.timeoutMs,
    (message) =>
      message.channel.id === cfg.chatChannelId &&
      message.author.id === cfg.miniClawClientId &&
      message.content.includes(`E2E_CHAT_OK ${cfg.runId}`)
  );
  const sent = await channel.send(`<@${cfg.miniClawClientId}> e2e chat ${cfg.runId}`);
  transcript.push(`sender chat: ${sent.content}`);
  const reply = await messageWait;
  transcript.push(`miniclaw chat: ${reply.content}`);
}

async function runTaskCase(client: Client, cfg: HarnessConfig, transcript: string[]): Promise<string> {
  return await runTaskLikeCase(client, cfg, cfg.taskChannelId, `e2e task ${cfg.runId}`, cfg.runId, transcript);
}

async function runTaskLikeCase(
  client: Client,
  cfg: HarnessConfig,
  channelId: string,
  prompt: string,
  expectedRunId: string,
  transcript: string[]
): Promise<string> {
  const channel = await fetchTextChannel(client, channelId);
  const replyWait = waitForMessage(
    client,
    "task creation reply",
    cfg.timeoutMs,
    (message) =>
      message.channel.id === channelId &&
      message.author.id === cfg.miniClawClientId &&
      /任务已创建/.test(message.content)
  );
  const sent = await channel.send(prompt);
  transcript.push(`sender task: ${sent.content}`);
  const created = await replyWait;
  transcript.push(`miniclaw task-created: ${created.content}`);
  const threadId = created.content.match(/<#(\d+)>/)?.[1];
  if (!threadId) throw new Error(`Could not parse task thread id from reply: ${created.content}`);
  const thread = await fetchTextChannel(client, threadId);

  await waitUntil("task completion sentinel", cfg.timeoutMs, async () => {
    const messages = await thread.messages.fetch({ limit: 20 });
    const found = messages.find((m) => m.content.includes(`E2E_TASK_OK ${expectedRunId}`));
    if (found) {
      transcript.push(`miniclaw task-result: ${found.content}`);
      return found;
    }
    return undefined;
  });

  await waitUntil("task completed embed", cfg.timeoutMs, async () => {
    const messages = await thread.messages.fetch({ limit: 20 });
    return messages.find((m) => m.embeds.some((embed) => embed.title?.includes("任务完成")));
  });

  return threadId;
}

async function runAttachmentCase(client: Client, cfg: HarnessConfig, transcript: string[], artifactDir: string): Promise<void> {
  const channel = await fetchTextChannel(client, cfg.chatChannelId);
  const attachmentRunId = `${cfg.runId}-attachment`;
  const textPath = join(artifactDir, "e2e-attachment.txt");
  const imagePath = join(artifactDir, "e2e-image.png");
  const pdfPath = join(artifactDir, "e2e-document.pdf");
  writeFileSync(textPath, `attachment fixture for ${attachmentRunId}\n`, "utf8");
  writeFileSync(imagePath, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  ));
  writeFileSync(pdfPath, "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", "utf8");
  const messageWait = waitForMessage(
    client,
    "attachment chat sentinel",
    cfg.timeoutMs,
    (message) =>
      message.channel.id === cfg.chatChannelId &&
      message.author.id === cfg.miniClawClientId &&
      message.content.includes(`E2E_CHAT_OK ${attachmentRunId}`)
  );
  await channel.send({
    content: `<@${cfg.miniClawClientId}> e2e attachment ${attachmentRunId}`,
    files: [
      new AttachmentBuilder(textPath),
      new AttachmentBuilder(imagePath),
      new AttachmentBuilder(pdfPath),
    ],
  });
  transcript.push(`sender attachment: e2e attachment ${attachmentRunId}`);
  const reply = await messageWait;
  transcript.push(`miniclaw attachment: ${reply.content}`);
}

async function runSmartRouterCase(client: Client, cfg: HarnessConfig, transcript: string[]): Promise<void> {
  const smartRunId = `${cfg.runId}-smart`;
  await runTaskLikeCase(
    client,
    cfg,
    cfg.chatChannelId,
    `please implement e2e task ${smartRunId}`,
    smartRunId,
    transcript
  );
}

async function runFollowupCase(client: Client, cfg: HarnessConfig, threadId: string, transcript: string[]): Promise<void> {
  const thread = await fetchTextChannel(client, threadId);
  const followRunId = `${cfg.runId}-followup`;
  const before = Date.now();
  await thread.send(`e2e followup ${followRunId}`);
  transcript.push(`sender followup: e2e followup ${followRunId}`);
  await waitUntil("thread follow-up sentinel", cfg.timeoutMs, async () => {
    const messages = await thread.messages.fetch({ limit: 30 });
    const found = messages.find((m) =>
      m.author.id === cfg.miniClawClientId &&
      m.createdTimestamp >= before &&
      m.content.includes(`E2E_TASK_OK ${followRunId}`)
    );
    if (found) transcript.push(`miniclaw followup-result: ${found.content}`);
    return found;
  });
}

function writeDbSummary(dbPath: string, artifactDir: string): void {
  const db = new Database(dbPath, { readonly: true });
  try {
    const tasks = db.prepare(
      "SELECT id, discord_thread_id, discord_user_id, status, session_id, result_summary, cost_usd, duration_ms, created_at, completed_at FROM tasks ORDER BY created_at"
    ).all();
    const chatHistoryCount = db.prepare("SELECT COUNT(*) AS count FROM chat_history").get() as { count: number };
    writeFileSync(join(artifactDir, "db-summary.json"), JSON.stringify({
      tasks,
      chatHistoryCount: chatHistoryCount.count,
    }, null, 2), "utf8");
  } finally {
    db.close();
  }
}

function classifyFailure(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Timed out/i.test(msg)) return "timeout";
  if (/Discord|Unknown Channel|Missing Access|Missing Permissions|401|403|429/i.test(msg)) return "discord_api";
  if (/ECONN|ENOTFOUND|ETIMEDOUT|network/i.test(msg)) return "network";
  return "code_or_assertion";
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const artifactDir = cfg.keepArtifacts
    ? join(cfg.repoRoot, "artifacts", "e2e", cfg.runId)
    : mkdtempSync(join(tmpdir(), "miniclaw-discord-e2e-artifacts-"));
  mkdirSync(artifactDir, { recursive: true });
  const transcript: string[] = [`# Discord E2E Transcript`, ``, `run_id: ${cfg.runId}`];

  const sender = createDiscordClient();
  await sender.login(cfg.senderToken);
  if (!sender.user) throw new Error("Sender bot login did not expose user");

  const tempRoot = mkdtempSync(join(tmpdir(), "miniclaw-discord-e2e-"));
  const { configPath, dbPath } = writeMiniClawConfig(tempRoot, cfg, sender.user.id);
  const mini = startMiniClaw(configPath, cfg, artifactDir);

  try {
    await mini.ready;
    transcript.push(`miniclaw ready: ${cfg.miniClawClientId}`);
    if (cfg.cases.has("chat")) await runChatCase(sender, cfg, transcript);
    if (cfg.cases.has("attachment")) await runAttachmentCase(sender, cfg, transcript, artifactDir);
    if (cfg.cases.has("smart-router")) await runSmartRouterCase(sender, cfg, transcript);
    let threadId = "";
    if (cfg.cases.has("task") || cfg.cases.has("followup")) {
      threadId = await runTaskCase(sender, cfg, transcript);
    }
    if (cfg.cases.has("followup")) await runFollowupCase(sender, cfg, threadId, transcript);
    writeDbSummary(dbPath, artifactDir);
    writeFileSync(join(artifactDir, "discord-transcript.md"), `${transcript.join("\n")}\n`, "utf8");
    writeFileSync(join(artifactDir, "summary.json"), JSON.stringify({
      runId: cfg.runId,
      fakeAgent: cfg.fakeAgent,
      cases: [...cfg.cases],
      artifactDir,
      status: "passed",
    }, null, 2));
    console.log(`Discord E2E passed: ${cfg.runId}`);
    console.log(`Artifacts: ${pathToFileURL(artifactDir).href}`);
  } catch (err) {
    writeFileSync(join(artifactDir, "failure.json"), JSON.stringify({
      runId: cfg.runId,
      status: "failed",
      category: classifyFailure(err),
      error: err instanceof Error ? err.stack ?? err.message : String(err),
    }, null, 2), "utf8");
    writeFileSync(join(artifactDir, "discord-transcript.md"), `${transcript.join("\n")}\n`, "utf8");
    throw err;
  } finally {
    mini.child.kill("SIGTERM");
    sender.destroy();
    if (!cfg.keepArtifacts) rmSync(artifactDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
