#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import yaml from "js-yaml";

type Status = "OK" | "WARN" | "FAIL";

interface Check {
  status: Status;
  label: string;
  detail?: string;
}

type PlainObject = Record<string, unknown>;

const PLACEHOLDERS = new Set([
  "",
  "your_bot_token",
  "your_discord_application_id",
  "your_discord_guild_id",
  "your_discord_user_id",
  "your_anthropic_api_key",
  "your_openai_api_key",
]);

function hasArg(name: string): boolean {
  return process.argv.slice(2).includes(name);
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

function commandExists(command: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" }).status === 0;
}

function runCheck(label: string, command: string, args: string[], options: { cwd?: string } = {}): Check {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) return { status: "OK", label };
  const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim().split(/\r?\n/).slice(-4).join(" ");
  return { status: "FAIL", label, detail: detail || `exit ${result.status ?? "unknown"}` };
}

function readEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function meaningful(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return PLACEHOLDERS.has(trimmed) ? "" : trimmed;
}

function loadConfig(path: string): { config: PlainObject; error?: string } {
  if (!existsSync(path)) return { config: {}, error: "missing" };
  try {
    return { config: asObject(yaml.load(readFileSync(path, "utf8")) ?? {}) };
  } catch (err) {
    return { config: {}, error: err instanceof Error ? err.message : String(err) };
  }
}

function statusLine(check: Check): string {
  const detail = check.detail ? ` - ${check.detail}` : "";
  return `${check.status.padEnd(4)} ${check.label}${detail}`;
}

function pm2Status(): Check {
  if (!commandExists("pm2")) return { status: "WARN", label: "PM2", detail: "not installed; production local run needs pm2" };
  const result = spawnSync("pm2", ["jlist"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) return { status: "WARN", label: "PM2", detail: "installed but jlist failed" };
  try {
    const apps = JSON.parse(result.stdout) as unknown;
    if (!Array.isArray(apps)) return { status: "WARN", label: "PM2", detail: "jlist did not return an array" };
    const app = apps.find((entry) => isPlainObject(entry) && isPlainObject(entry.pm2_env) && entry.pm2_env.name === "miniclaw") as PlainObject | undefined;
    if (!app || !isPlainObject(app.pm2_env)) return { status: "WARN", label: "PM2 miniclaw app", detail: "not started yet" };
    return { status: app.pm2_env.status === "online" ? "OK" : "WARN", label: "PM2 miniclaw app", detail: String(app.pm2_env.status) };
  } catch {
    return { status: "WARN", label: "PM2", detail: "could not parse jlist" };
  }
}

const skipInstall = hasArg("--skip-install");
const skipBuild = hasArg("--skip-build");
const envPath = resolve(process.cwd(), ".env");
const env = readEnv(envPath);
const configPath = resolveHome(process.env.MINICLAW_CONFIG || meaningful(env.MINICLAW_CONFIG) || "~/.miniclaw/config.yaml");
const loaded = loadConfig(configPath);
const config = loaded.config;
const discord = asObject(config.discord);
const runtime = asObject(config.runtime);
const agent = asObject(config.agent);
const provider = meaningful(String(runtime.default_agent ?? agent.provider ?? "")) || "codex";
const checks: Check[] = [];

const nodeMajor = Number(process.versions.node.split(".")[0]);
checks.push(nodeMajor >= 22
  ? { status: "OK", label: "Node", detail: process.version }
  : { status: "FAIL", label: "Node", detail: `expected >=22, got ${process.version}` });

checks.push(commandExists("pnpm")
  ? runCheck("pnpm", "pnpm", ["--version"])
  : { status: "FAIL", label: "pnpm", detail: "not found" });

checks.push(pm2Status());

if (skipInstall) checks.push({ status: "WARN", label: "Frozen install", detail: "skipped by --skip-install" });
else checks.push(runCheck("Frozen install", "pnpm", ["install", "--frozen-lockfile"]));

if (skipBuild) checks.push({ status: "WARN", label: "Build", detail: "skipped by --skip-build" });
else checks.push(runCheck("Build", "pnpm", ["run", "build"]));

checks.push(existsSync(envPath)
  ? { status: "OK", label: ".env", detail: envPath }
  : { status: "FAIL", label: ".env", detail: "missing; run pnpm run setup" });

checks.push(meaningful(env.DISCORD_TOKEN)
  ? { status: "OK", label: "DISCORD_TOKEN" }
  : { status: "FAIL", label: "DISCORD_TOKEN", detail: "missing or placeholder" });

checks.push(loaded.error
  ? { status: "FAIL", label: "config.yaml", detail: `${configPath}: ${loaded.error}` }
  : { status: "OK", label: "config.yaml", detail: configPath });

for (const [label, value] of [
  ["discord.client_id", discord.client_id],
  ["discord.guild_id", discord.guild_id],
  ["discord.allowed_user_id", discord.allowed_user_id],
] as const) {
  checks.push(meaningful(value)
    ? { status: "OK", label }
    : { status: "FAIL", label, detail: "missing or placeholder" });
  if (value !== undefined && typeof value !== "string") {
    checks.push({ status: "FAIL", label, detail: "must be quoted as a YAML string" });
  }
}

if (provider === "claude") {
  checks.push(meaningful(env.ANTHROPIC_API_KEY)
    ? { status: "OK", label: "Claude provider key" }
    : { status: "FAIL", label: "Claude provider key", detail: "ANTHROPIC_API_KEY missing" });
} else {
  checks.push(meaningful(env.OPENAI_API_KEY) || existsSync(resolveHome("~/.codex"))
    ? { status: "OK", label: "Codex provider auth", detail: meaningful(env.OPENAI_API_KEY) ? "OPENAI_API_KEY present" : "~/.codex exists" }
    : { status: "WARN", label: "Codex provider auth", detail: "no OPENAI_API_KEY and ~/.codex not found" });
}

checks.push({ status: "WARN", label: "Slash commands", detail: "run pnpm register after Discord ID or command schema changes" });

process.stdout.write("MiniClaw Setup Doctor\n\n");
for (const check of checks) process.stdout.write(`${statusLine(check)}\n`);

const failures = checks.filter((check) => check.status === "FAIL");
process.stdout.write("\nNext:\n");
if (failures.length) {
  process.stdout.write("1. Run pnpm run setup and fill missing Discord/provider values.\n");
  process.stdout.write("2. Re-run pnpm run doctor:setup.\n");
  process.stdout.write("3. Run pnpm register once setup is green.\n");
} else {
  process.stdout.write("1. Run pnpm register if commands are not current.\n");
  process.stdout.write("2. Start dev with pnpm dev or production local with pm2 start ecosystem.config.cjs.\n");
  process.stdout.write("3. Verify /health in Discord.\n");
}

process.exit(failures.length ? 1 : 0);
