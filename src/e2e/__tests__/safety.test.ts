import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ENV_KEYS = [
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_GUILD_ID",
  "ANTHROPIC_API_KEY",
  "MINICLAW_CONFIG",
  "MINICLAW_AGENT_PROVIDER",
  "MINICLAW_ALLOWED_USER_ID",
  "MINICLAW_DEFAULT_CWD",
  "MINICLAW_DB_PATH",
  "MINICLAW_MEMORY_PATH",
  "MINICLAW_E2E_MODE",
  "MINICLAW_E2E_SENDER_USER_IDS",
  "MINICLAW_DISABLE_SCHEDULER",
] as const;

let tmpDir: string;
let previousEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.resetModules();
  tmpDir = mkdtempSync(join(tmpdir(), "miniclaw-e2e-safety-"));
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

async function loadSafety(e2eMode: boolean) {
  const cfg = join(tmpDir, "config.yaml");
  writeFileSync(cfg, `
discord:
  token: "token-yaml"
  client_id: "client-yaml"
  guild_id: "guild-yaml"
  allowed_user_id: "owner-user"
agent:
  provider: codex
  default_cwd: "${tmpDir}"
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
`);
  process.env.MINICLAW_CONFIG = cfg;
  if (e2eMode) {
    process.env.MINICLAW_E2E_MODE = "true";
    process.env.MINICLAW_E2E_SENDER_USER_IDS = "sender-bot,sender-user";
    process.env.MINICLAW_DISABLE_SCHEDULER = "true";
  }
  return import("../safety.js");
}

describe("E2E safety author allowlist", () => {
  it("keeps normal production author guard behavior", async () => {
    const { isAllowedDiscordMessageAuthor } = await loadSafety(false);

    expect(isAllowedDiscordMessageAuthor("owner-user", false)).toBe(true);
    expect(isAllowedDiscordMessageAuthor("owner-user", true)).toBe(false);
    expect(isAllowedDiscordMessageAuthor("sender-bot", true)).toBe(false);
    expect(isAllowedDiscordMessageAuthor("other-user", false)).toBe(false);
  });

  it("allows only configured E2E senders to bypass the bot author guard", async () => {
    const { isAllowedDiscordMessageAuthor } = await loadSafety(true);

    expect(isAllowedDiscordMessageAuthor("sender-bot", true)).toBe(true);
    expect(isAllowedDiscordMessageAuthor("sender-user", false)).toBe(true);
    expect(isAllowedDiscordMessageAuthor("other-bot", true)).toBe(false);
    expect(isAllowedDiscordMessageAuthor("owner-user", false)).toBe(true);
  });
});
