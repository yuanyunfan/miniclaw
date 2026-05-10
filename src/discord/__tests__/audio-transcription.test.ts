import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "MINICLAW_AUDIO_TRANSCRIPTION_ENABLED",
  "MINICLAW_AUDIO_TRANSCRIPTION_MODEL",
  "MINICLAW_AUDIO_TRANSCRIPTION_MAX_MB",
  "MINICLAW_AUDIO_TRANSCRIPTION_LANGUAGE",
] as const;

let previousEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.resetModules();
  previousEnv = {};
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = previousEnv[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("transcribeAudio", () => {
  it("posts audio to OpenAI transcriptions API", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_BASE_URL = "https://api.openai.test/v1/";
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_LANGUAGE = "zh";

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ text: "你好 MiniClaw" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const { transcribeAudio } = await import("../audio-transcription.js");

    const result = await transcribeAudio({
      buffer: Buffer.from("fake-audio"),
      filename: "voice-message.m4a",
      contentType: "audio/mp4",
      size: 10,
    }, { fetchFn: fetchMock });

    expect(result).toEqual({ text: "你好 MiniClaw", model: "gpt-4o-transcribe" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.test/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer test-openai-key" },
        body: expect.any(FormData),
      })
    );
  });

  it("converts Discord ogg voice messages before upload", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ text: "converted transcript" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const convertOggToWebm = vi.fn().mockResolvedValue({
      buffer: Buffer.from("fake-webm"),
      filename: "voice-message.webm",
      contentType: "audio/webm",
    });
    const { transcribeAudio } = await import("../audio-transcription.js");

    const result = await transcribeAudio({
      buffer: Buffer.from("fake-ogg"),
      filename: "voice-message.ogg",
      contentType: "audio/ogg",
      size: 10,
    }, { fetchFn: fetchMock, convertOggToWebm });

    expect(result.text).toBe("converted transcript");
    expect(convertOggToWebm).toHaveBeenCalledWith({
      buffer: Buffer.from("fake-ogg"),
      filename: "voice-message.ogg",
      contentType: "audio/ogg",
      size: 10,
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const form = init.body as FormData;
    const file = form.get("file") as File;
    expect(file.name).toBe("voice-message.webm");
    expect(file.type).toBe("audio/webm");
  });

  it("fails clearly when OPENAI_API_KEY is missing", async () => {
    const { transcribeAudio } = await import("../audio-transcription.js");

    await expect(transcribeAudio({
      buffer: Buffer.from("fake-audio"),
      filename: "voice-message.ogg",
      contentType: "audio/ogg",
      size: 10,
    })).rejects.toThrow(/缺少 OPENAI_API_KEY/);
  });

  it("surfaces OpenAI API errors with status and body", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("unsupported file", { status: 400 })
    );
    const { transcribeAudio } = await import("../audio-transcription.js");

    await expect(transcribeAudio({
      buffer: Buffer.from("fake-audio"),
      filename: "voice-message.m4a",
      contentType: "audio/mp4",
      size: 10,
    }, { fetchFn: fetchMock })).rejects.toThrow(/OpenAI transcription HTTP 400: unsupported file/);
  });

  it("uses default model and enforces max size", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_MAX_MB = "1";
    const { transcribeAudio } = await import("../audio-transcription.js");

    await expect(transcribeAudio({
      buffer: Buffer.alloc(2 * 1024 * 1024),
      filename: "voice-message.ogg",
      contentType: "audio/ogg",
      size: 2 * 1024 * 1024,
    })).rejects.toThrow(/超过语音转写 1MB 上限/);
  });
});
