import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "MINICLAW_CONFIG",
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_GUILD_ID",
  "MINICLAW_ALLOWED_USER_ID",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
] as const;

let tmpDir: string;
let previousEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.resetModules();
  tmpDir = mkdtempSync(join(tmpdir(), "miniclaw-chat-api-"));
  previousEnv = {};
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key];
    delete process.env[key];
  }
  // src/config imports proxy.ts, which loads dotenv/config. Keep these present
  // but blank so local .env secrets do not steer this test into Anthropic.
  process.env.ANTHROPIC_API_KEY = "";
  process.env.ANTHROPIC_BASE_URL = "";
  process.env.OPENAI_API_KEY = "";
  process.env.OPENAI_BASE_URL = "";

  const cfg = join(tmpDir, "config.yaml");
  writeFileSync(cfg, `
discord:
  token: "test-token"
  client_id: "test-client"
  guild_id: "test-guild"
  allowed_user_id: "test-user"
agent:
  provider: codex
  default_cwd: "${tmpDir}"
openai:
  base_url: "https://llm.example.test/v1"
storage:
  db_path: "${join(tmpDir, "data.db")}"
  memory_path: "${join(tmpDir, "MEMORY.md")}"
`);
  process.env.MINICLAW_CONFIG = cfg;
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) {
    const previous = previousEnv[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  rmSync(tmpDir, { recursive: true, force: true });
  vi.resetModules();
});

describe("chat lightweight API mode", () => {
  it("uses OpenAI-compatible chat completions when requested instead of Codex thread chat", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: "api-chat-model",
      usage: { prompt_tokens: 12, completion_tokens: 3 },
      choices: [{ message: { content: "api ok" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const { __testables } = await import("../chat.js");
    const streamedText: string[] = [];

    const result = await __testables.chatWithLightweightApi(
      "base system",
      "hello",
      undefined,
      undefined,
      {
        onToolUse: vi.fn(),
        onText: (text) => streamedText.push(text),
      },
      "<weixin_message_context />",
      undefined,
    );

    expect(result).toMatchObject({
      reply: "api ok",
      provider: "openai_compatible",
      tokensSummary: "in: 12 · out: 3",
    });
    expect(streamedText).toEqual(["api ok"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://llm.example.test/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("轻量聊天"),
    });
    expect(body.messages[0].content).toContain("base system");
    expect(JSON.stringify(body.messages)).toContain("<weixin_message_context />");
  });
});
