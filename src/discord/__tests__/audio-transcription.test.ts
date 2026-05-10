import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "MINICLAW_AUDIO_TRANSCRIPTION_ENABLED",
  "MINICLAW_AUDIO_TRANSCRIPTION_PROVIDER",
  "MINICLAW_AUDIO_TRANSCRIPTION_MODEL",
  "MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_MODEL",
  "MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_PYTHON",
  "MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_DEVICE",
  "MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_COMPUTE_TYPE",
  "MINICLAW_AUDIO_TRANSCRIPTION_MAX_MB",
  "MINICLAW_AUDIO_TRANSCRIPTION_TIMEOUT_MS",
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

  it("uses local faster-whisper automatically when OPENAI_API_KEY is missing", async () => {
    const transcribeWithLocalFasterWhisper = vi.fn().mockResolvedValue("本地转写结果");
    const { transcribeAudio } = await import("../audio-transcription.js");

    const result = await transcribeAudio({
      buffer: Buffer.from("fake-audio"),
      filename: "voice-message.ogg",
      contentType: "audio/ogg",
      size: 10,
    }, { transcribeWithLocalFasterWhisper });

    expect(result).toEqual({ text: "本地转写结果", model: "local_faster_whisper:base" });
    expect(transcribeWithLocalFasterWhisper).toHaveBeenCalledWith({
      buffer: Buffer.from("fake-audio"),
      filename: "voice-message.ogg",
      contentType: "audio/ogg",
      size: 10,
    });
  });

  it("fails clearly when OPENAI_API_KEY is missing for forced OpenAI provider", async () => {
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_PROVIDER = "openai";
    const { transcribeAudio } = await import("../audio-transcription.js");

    await expect(transcribeAudio({
      buffer: Buffer.from("fake-audio"),
      filename: "voice-message.ogg",
      contentType: "audio/ogg",
      size: 10,
    })).rejects.toThrow(/缺少 OPENAI_API_KEY/);
  });

  it("supports OpenAI-compatible transcription endpoints without an API key", async () => {
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_PROVIDER = "openai_compatible";
    process.env.OPENAI_BASE_URL = "http://stt.local/v1/";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ text: "compatible transcript" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const { transcribeAudio } = await import("../audio-transcription.js");

    const result = await transcribeAudio({
      buffer: Buffer.from("fake-audio"),
      filename: "voice-message.wav",
      contentType: "audio/wav",
      size: 10,
    }, { fetchFn: fetchMock });

    expect(result).toEqual({ text: "compatible transcript", model: "gpt-4o-mini-transcribe" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://stt.local/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
      })
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toBeUndefined();
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

  it("runs local faster-whisper through ffmpeg and configured Python", async () => {
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_PROVIDER = "local_faster_whisper";
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_MODEL = "small";
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_PYTHON = "python-test";
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_DEVICE = "cpu";
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_COMPUTE_TYPE = "int8";
    process.env.MINICLAW_AUDIO_TRANSCRIPTION_TIMEOUT_MS = "5000";
    const runFfmpeg = vi.fn(async (_args: string[], _options?: { timeoutMs?: number }) => undefined);
    const runProcess = vi.fn(async (
      _command: string,
      _args: string[],
      _options?: { timeoutMs?: number },
    ) => ({
      stdout: JSON.stringify({ ok: true, text: "hello local" }),
      stderr: "",
    }));
    const { __testables } = await import("../audio-transcription.js");

    const text = await __testables.transcribeWithLocalFasterWhisper({
      buffer: Buffer.from("fake-audio"),
      filename: "voice-message.ogg",
      contentType: "audio/ogg",
      size: 10,
    }, { runFfmpeg, runProcess });

    expect(text).toBe("hello local");
    expect(runFfmpeg).toHaveBeenCalledWith(
      expect.arrayContaining(["-ar", "16000"]),
      expect.objectContaining({ timeoutMs: 5000 })
    );
    const [python, args, options] = runProcess.mock.calls[0];
    expect(python).toBe("python-test");
    expect(args).toEqual([
      "-c",
      expect.stringContaining("WhisperModel"),
      expect.stringMatching(/input\.wav$/),
      "small",
      "cpu",
      "int8",
      "",
    ]);
    expect(options).toMatchObject({ timeoutMs: 5000 });
  });

  it("surfaces missing local faster-whisper dependency clearly", async () => {
    const { __testables } = await import("../audio-transcription.js");

    expect(() => __testables.parseLocalFasterWhisperOutput(JSON.stringify({
      ok: false,
      error_code: "missing_faster_whisper",
      error: "No module named 'faster_whisper'",
    }))).toThrow(/未安装 faster-whisper/);
  });
});
