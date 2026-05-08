// Vitest globalSetup —— 在所有测试文件 import 之前跑一次。设置 env vars。
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export default function setup() {
  const testDir = mkdtempSync(join(tmpdir(), "miniclaw-vitest-"));
  const testDb = join(testDir, "test.db");
  const testMemory = join(testDir, "MEMORY.md");
  process.env.MINICLAW_DB_PATH = testDb;
  process.env.MINICLAW_MEMORY_PATH = testMemory;
  // Required env vars (config.ts throws if missing)
  process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN ?? "test-token";
  process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? "test-client-id";
  process.env.DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID ?? "test-guild-id";
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "test-anthropic-key";
  process.env.MINICLAW_ALLOWED_USER_ID = process.env.MINICLAW_ALLOWED_USER_ID ?? "test-user-id";
}
