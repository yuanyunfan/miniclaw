#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import yaml from "js-yaml";

type Provider = "codex" | "claude";

interface Args {
  dryRun: boolean;
  yes: boolean;
  register?: boolean;
  pm2?: boolean;
}

interface SetupAnswers {
  discordToken: string;
  clientId: string;
  guildId: string;
  allowedUserId: string;
  provider: Provider;
  apiKey?: string;
  defaultCwd: string;
  smartRouter: boolean;
  register: boolean;
  pm2: boolean;
}

type PlainObject = Record<string, unknown>;

const DEFAULT_CONFIG_PATH = "~/.miniclaw/config.yaml";
const PLACEHOLDER_VALUES = new Set([
  "",
  "your_bot_token",
  "your_discord_application_id",
  "your_discord_guild_id",
  "your_discord_user_id",
  "your_anthropic_api_key",
  "your_openai_api_key",
]);

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, yes: false };
  for (const arg of argv) {
    if (arg === "--") continue;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--yes" || arg === "-y") args.yes = true;
    else if (arg === "--register") args.register = true;
    else if (arg === "--skip-register") args.register = false;
    else if (arg === "--pm2") args.pm2 = true;
    else if (arg === "--no-pm2") args.pm2 = false;
    else if (arg === "--help" || arg === "-h") {
      output.write("Usage: pnpm run setup -- [--dry-run] [--yes] [--register|--skip-register] [--pm2|--no-pm2]\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function resolveHome(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): PlainObject {
  return isPlainObject(value) ? value : {};
}

function readEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    out[match[1]] = unquoteEnv(match[2].trim());
  }
  return out;
}

function unquoteEnv(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function meaningful(value: string | undefined): string {
  if (!value) return "";
  return PLACEHOLDER_VALUES.has(value.trim()) ? "" : value.trim();
}

function envLine(key: string, value: string): string {
  if (/^[A-Za-z0-9_./:@~=-]+$/.test(value)) return `${key}=${value}`;
  return `${key}=${JSON.stringify(value)}`;
}

function updateEnv(raw: string, updates: Record<string, string | undefined>): string {
  const remaining = new Map(Object.entries(updates).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const lines = raw ? raw.split(/\r?\n/) : [];
  const next = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match) return line;
    const value = remaining.get(match[1]);
    if (value === undefined) return line;
    remaining.delete(match[1]);
    return envLine(match[1], value);
  });

  if (remaining.size) {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push("# Added by pnpm run setup");
    for (const [key, value] of remaining) next.push(envLine(key, value));
  }

  return next.join("\n").replace(/\n*$/, "\n");
}

function loadConfig(path: string): PlainObject {
  if (!existsSync(path)) return {};
  const parsed = yaml.load(readFileSync(path, "utf8")) ?? {};
  return asObject(parsed);
}

function mergeConfig(config: PlainObject, answers: SetupAnswers): PlainObject {
  const next: PlainObject = { ...config };
  const routing = { ...asObject(next.routing) };
  const smartRouter = { ...asObject(routing.smart_router) };
  const runtime = { ...asObject(next.runtime) };
  const agent = { ...asObject(next.agent) };
  const discord = { ...asObject(next.discord) };

  discord.client_id = answers.clientId;
  discord.guild_id = answers.guildId;
  discord.allowed_user_id = answers.allowedUserId;

  if (!Array.isArray(routing.auto_reply_channels)) routing.auto_reply_channels = [];
  if (!Array.isArray(routing.task_channels)) routing.task_channels = [];
  smartRouter.enabled = answers.smartRouter;
  smartRouter.default_mode = "confirm";
  routing.smart_router = smartRouter;

  runtime.default_agent = answers.provider;
  agent.provider = answers.provider;
  agent.default_cwd = answers.defaultCwd;
  agent.max_concurrent_tasks = 1;
  agent.register_commands_on_start = false;

  next.discord = discord;
  next.routing = routing;
  next.runtime = runtime;
  next.agent = agent;
  return next;
}

async function hiddenQuestion(prompt: string): Promise<string> {
  if (!input.isTTY) {
    const rl = readline.createInterface({ input, output });
    try {
      return (await rl.question(prompt)).trim();
    } finally {
      rl.close();
    }
  }

  return await new Promise<string>((resolveAnswer, reject) => {
    let value = "";
    output.write(prompt);
    input.setRawMode(true);
    input.resume();

    const cleanup = () => {
      input.setRawMode(false);
      input.off("data", onData);
      output.write("\n");
    };

    const onData = (chunk: Buffer) => {
      const char = chunk.toString("utf8");
      if (char === "\u0003") {
        cleanup();
        reject(new Error("setup cancelled"));
        return;
      }
      if (char === "\r" || char === "\n") {
        cleanup();
        resolveAnswer(value.trim());
        return;
      }
      if (char === "\u007f") {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    };

    input.on("data", onData);
  });
}

async function collectAnswers(args: Args, envPath: string, configPath: string): Promise<SetupAnswers> {
  const existingEnv = readEnv(envPath);
  const existingConfig = loadConfig(configPath);
  const discord = asObject(existingConfig.discord);
  const runtime = asObject(existingConfig.runtime);
  const agent = asObject(existingConfig.agent);
  const routing = asObject(existingConfig.routing);
  const smartRouter = asObject(routing.smart_router);
  const ask = async (question: string, fallback = ""): Promise<string> => {
    if (args.yes) return fallback;
    const rl = readline.createInterface({ input, output });
    const suffix = fallback ? ` [${fallback}]` : "";
    try {
      const answer = await rl.question(`${question}${suffix}: `);
      return answer.trim() || fallback;
    } finally {
      rl.close();
    }
  };
  const askBool = async (question: string, fallback: boolean): Promise<boolean> => {
    if (args.yes) return fallback;
    const rl = readline.createInterface({ input, output });
    const suffix = fallback ? "Y/n" : "y/N";
    try {
      const answer = (await rl.question(`${question} [${suffix}]: `)).trim().toLowerCase();
      if (!answer) return fallback;
      return ["y", "yes", "true", "1"].includes(answer);
    } finally {
      rl.close();
    }
  };

  const providerDefault = (runtime.default_agent === "claude" || agent.provider === "claude") ? "claude" : "codex";
  const providerRaw = (await ask("Default provider (codex|claude)", providerDefault)).toLowerCase();
  const provider: Provider = providerRaw === "claude" ? "claude" : "codex";
  const tokenDefault = meaningful(existingEnv.DISCORD_TOKEN);
  const token = args.yes ? tokenDefault : await hiddenQuestion(`Discord Bot Token${tokenDefault ? " [keep existing]" : ""}: `);
  const apiKeyName = provider === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const existingApiKey = meaningful(existingEnv[apiKeyName]);
  const apiKey = args.yes ? existingApiKey : await hiddenQuestion(
    provider === "claude"
      ? `Anthropic API Key${existingApiKey ? " [keep existing]" : ""}: `
      : `OpenAI API Key (optional; blank uses local codex login)${existingApiKey ? " [keep existing]" : ""}: `
  );

  return {
    discordToken: token || tokenDefault,
    clientId: await ask("Discord Client ID", meaningful(String(discord.client_id ?? ""))),
    guildId: await ask("Discord Guild ID", meaningful(String(discord.guild_id ?? ""))),
    allowedUserId: await ask("Allowed Discord User ID", meaningful(String(discord.allowed_user_id ?? ""))),
    provider,
    apiKey: apiKey || existingApiKey || undefined,
    defaultCwd: await ask("Default task cwd", meaningful(String(agent.default_cwd ?? "")) || "~"),
    smartRouter: await askBool("Enable Smart Router", smartRouter.enabled === true),
    register: args.register ?? await askBool("Run pnpm register after writing config", false),
    pm2: args.pm2 ?? await askBool("Start MiniClaw with PM2 after setup", false),
  };
}

function backup(path: string): void {
  if (!existsSync(path)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  copyFileSync(path, `${path}.bak-${stamp}`);
}

function run(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: "inherit" });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const envPath = resolve(process.cwd(), ".env");
  const existingEnv = readEnv(envPath);
  const configEnvValue = process.env.MINICLAW_CONFIG ?? (meaningful(existingEnv.MINICLAW_CONFIG) || DEFAULT_CONFIG_PATH);
  const configPath = resolveHome(configEnvValue);

  output.write(`MiniClaw setup\n.env: ${envPath}\nconfig: ${configPath}\n\n`);
  const answers = await collectAnswers(args, envPath, configPath);

  const envUpdates: Record<string, string | undefined> = {};
  envUpdates["DISCORD_" + "TOKEN"] = answers.discordToken || undefined;
  envUpdates.MINICLAW_CONFIG = configEnvValue;
  envUpdates["ANTHROPIC_" + "API_KEY"] = answers.provider === "claude" ? answers.apiKey : undefined;
  envUpdates["OPENAI_" + "API_KEY"] = answers.provider === "codex" ? answers.apiKey : undefined;
  const envRaw = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const nextEnv = updateEnv(envRaw, envUpdates);
  const nextConfig = mergeConfig(loadConfig(configPath), answers);
  const nextYaml = yaml.dump(nextConfig, { lineWidth: 120, quotingType: '"', forceQuotes: false });

  output.write("Planned updates:\n");
  output.write(`- ${envPath}: ${Object.keys(envUpdates).filter((key) => envUpdates[key]).join(", ")}\n`);
  output.write(`- ${configPath}: discord, routing.smart_router, runtime.default_agent, agent\n`);
  output.write(`- register: ${answers.register ? "yes" : "no"}\n`);
  output.write(`- pm2 start: ${answers.pm2 ? "yes" : "no"}\n`);

  if (args.dryRun) {
    output.write("\nDry run only; no files written.\n");
    return;
  }

  mkdirSync(dirname(configPath), { recursive: true });
  if (existsSync(envPath)) backup(envPath);
  if (existsSync(configPath)) backup(configPath);
  writeFileSync(envPath, nextEnv);
  writeFileSync(configPath, nextYaml);
  output.write("\nWrote setup files. Existing files were backed up with .bak-* suffixes.\n");

  if (answers.register) run("pnpm", ["register"]);
  if (answers.pm2) {
    run("pnpm", ["run", "build"]);
    run("pm2", ["start", "ecosystem.config.cjs"]);
  }

  output.write("\nNext: pnpm run doctor:setup\n");
}

await main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`setup error: ${message}\n`);
  process.exit(1);
});
