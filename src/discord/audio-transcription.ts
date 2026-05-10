import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { config, type AudioTranscriptionProvider } from "../config.js";

export interface AudioTranscriptionInput {
  buffer: Buffer;
  filename: string;
  contentType?: string | null;
  size: number;
}

export interface AudioTranscriptionResult {
  text: string;
  model: string;
}

interface AudioUpload {
  buffer: Buffer;
  filename: string;
  contentType?: string | null;
}

interface ProcessOutput {
  stdout: string;
  stderr: string;
}

interface ProcessRunOptions {
  timeoutMs?: number;
  notFoundMessage?: string;
  failureLabel?: string;
}

type ProcessRunner = (command: string, args: string[], options?: ProcessRunOptions) => Promise<ProcessOutput>;
type FfmpegRunner = (args: string[], options?: ProcessRunOptions) => Promise<void>;
type ResolvedAudioTranscriptionProvider = Exclude<AudioTranscriptionProvider, "auto">;

interface AudioTranscriptionDeps {
  fetchFn?: typeof fetch;
  convertOggToWebm?: (input: AudioTranscriptionInput) => Promise<AudioUpload>;
  transcribeWithLocalFasterWhisper?: (input: AudioTranscriptionInput) => Promise<string>;
  runFfmpeg?: FfmpegRunner;
  runProcess?: ProcessRunner;
}

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const MAX_ERROR_BODY_CHARS = 500;
const LOCAL_FASTER_WHISPER_SCRIPT = `
import json
import sys

def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)

try:
    from faster_whisper import WhisperModel
except ModuleNotFoundError as exc:
    emit({"ok": False, "error_code": "missing_faster_whisper", "error": str(exc)})
    raise SystemExit(0)

audio_path, model_name, device, compute_type, language = sys.argv[1:6]

try:
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    kwargs = {"beam_size": 1}
    if language:
        kwargs["language"] = language
    segments, _info = model.transcribe(audio_path, **kwargs)
    text = " ".join(
        segment.text.strip()
        for segment in segments
        if getattr(segment, "text", "").strip()
    ).strip()
    emit({"ok": True, "text": text})
except Exception as exc:
    emit({"ok": False, "error_code": "transcription_failed", "error": str(exc)})
`.trim();

function openaiBaseUrl(): string {
  return (config.openaiBaseUrl ?? OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function audioContentType(filename: string, contentType?: string | null): string {
  const normalized = contentType?.trim().toLowerCase();
  if (normalized?.startsWith("audio/")) return normalized;

  switch (extname(filename).toLowerCase()) {
    case ".mp3":
    case ".mpga":
    case ".mpeg":
      return "audio/mpeg";
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    case ".ogg":
      return "audio/ogg";
    case ".wav":
      return "audio/wav";
    case ".webm":
      return "audio/webm";
    case ".flac":
      return "audio/flac";
    default:
      return "application/octet-stream";
  }
}

function truncateErrorBody(body: string): string {
  return body.length > MAX_ERROR_BODY_CHARS
    ? `${body.slice(0, MAX_ERROR_BODY_CHARS)}...`
    : body;
}

function extractTranscriptText(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) return "";
  const value = (raw as { text?: unknown }).text;
  return typeof value === "string" ? value.trim() : "";
}

function shouldConvertOgg(input: AudioTranscriptionInput): boolean {
  const ext = extname(input.filename).toLowerCase();
  const ct = input.contentType?.toLowerCase() ?? "";
  return ext === ".ogg" || ct === "audio/ogg" || ct === "audio/opus";
}

function convertedWebmName(filename: string): string {
  const base = basename(filename).replace(/\.[^.]+$/, "");
  return `${base || "voice-message"}.webm`;
}

function safeAudioInputExt(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return /^\.[a-z0-9][a-z0-9_-]{0,15}$/.test(ext) ? ext : ".audio";
}

function resolveProvider(): ResolvedAudioTranscriptionProvider {
  if (config.audioTranscription.provider !== "auto") return config.audioTranscription.provider;
  return config.openaiApiKey ? "openai" : "local_faster_whisper";
}

async function runProcess(
  command: string,
  args: string[],
  options: ProcessRunOptions = {},
): Promise<ProcessOutput> {
  const failureLabel = options.failureLabel ?? command;

  return await new Promise<ProcessOutput>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };

    if (options.timeoutMs) {
      timer = setTimeout(() => {
        finish(() => {
          child.kill("SIGKILL");
          reject(new Error(`${failureLabel} timed out after ${options.timeoutMs}ms`));
        });
      }, options.timeoutMs);
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      finish(() => {
        if ((err as NodeJS.ErrnoException).code === "ENOENT" && options.notFoundMessage) {
          reject(new Error(options.notFoundMessage));
          return;
        }
        reject(err);
      });
    });
    child.on("close", (code, signal) => {
      finish(() => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }

        const detail = stderr.trim()
          ? `: ${truncateErrorBody(stderr.trim())}`
          : code !== null
            ? ` with code ${code}`
            : signal
              ? ` with signal ${signal}`
              : "";
        reject(new Error(`${failureLabel} failed${detail}`));
      });
    });
  });
}

async function runFfmpeg(args: string[], options: ProcessRunOptions & { runProcess?: ProcessRunner } = {}): Promise<void> {
  const runner = options.runProcess ?? runProcess;
  await runner("ffmpeg", args, {
    timeoutMs: options.timeoutMs,
    notFoundMessage: options.notFoundMessage ?? "语音转写需要本机 ffmpeg，但当前找不到 ffmpeg",
    failureLabel: options.failureLabel ?? "ffmpeg audio conversion",
  });
}

async function convertOggToWebm(
  input: AudioTranscriptionInput,
  deps: Pick<AudioTranscriptionDeps, "runFfmpeg" | "runProcess"> = {},
): Promise<AudioUpload> {
  const dir = await mkdtemp(join(tmpdir(), "miniclaw-audio-"));
  const inputPath = join(dir, "input.ogg");
  const outputName = convertedWebmName(input.filename);
  const outputPath = join(dir, outputName);

  try {
    await writeFile(inputPath, input.buffer);
    await (deps.runFfmpeg ?? runFfmpeg)([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-c:a",
      "libopus",
      outputPath,
    ], {
      runProcess: deps.runProcess,
      notFoundMessage: "Discord .ogg 语音需要 ffmpeg 转成 webm 后再转写，但当前找不到 ffmpeg",
    });
    return {
      buffer: await readFile(outputPath),
      filename: outputName,
      contentType: "audio/webm",
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function prepareAudioUpload(input: AudioTranscriptionInput, deps: AudioTranscriptionDeps): Promise<AudioUpload> {
  if (shouldConvertOgg(input)) {
    return deps.convertOggToWebm ? deps.convertOggToWebm(input) : convertOggToWebm(input, deps);
  }

  return {
    buffer: input.buffer,
    filename: input.filename,
    contentType: input.contentType,
  };
}

async function transcribeWithOpenAiApi(
  input: AudioTranscriptionInput,
  provider: "openai" | "openai_compatible",
  deps: AudioTranscriptionDeps,
): Promise<AudioTranscriptionResult> {
  if (provider === "openai" && !config.openaiApiKey) {
    throw new Error("缺少 OPENAI_API_KEY，无法调用 OpenAI Audio Transcriptions API");
  }
  if (provider === "openai_compatible" && !config.openaiBaseUrl) {
    throw new Error("缺少 OPENAI_BASE_URL，无法调用 OpenAI-compatible Audio Transcriptions API");
  }

  const upload = await prepareAudioUpload(input, deps);
  const form = new FormData();
  const blob = new Blob([new Uint8Array(upload.buffer)], {
    type: audioContentType(upload.filename, upload.contentType),
  });
  form.append("file", blob, upload.filename);
  form.append("model", config.audioTranscription.model);
  form.append("response_format", "json");
  if (config.audioTranscription.language) {
    form.append("language", config.audioTranscription.language);
  }

  const init: RequestInit = {
    method: "POST",
    body: form,
  };
  if (config.openaiApiKey) {
    init.headers = { Authorization: `Bearer ${config.openaiApiKey}` };
  }

  const response = await (deps.fetchFn ?? fetch)(`${openaiBaseUrl()}/audio/transcriptions`, init);

  if (!response.ok) {
    const body = truncateErrorBody(await response.text().catch(() => ""));
    const label = provider === "openai" ? "OpenAI" : "OpenAI-compatible";
    throw new Error(`${label} transcription HTTP ${response.status}${body ? `: ${body}` : ""}`);
  }

  const text = extractTranscriptText(await response.json());
  if (!text) {
    const label = provider === "openai" ? "OpenAI" : "OpenAI-compatible";
    throw new Error(`${label} transcription response did not include text`);
  }

  return { text, model: config.audioTranscription.model };
}

function parseLocalFasterWhisperOutput(stdout: string): string {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  let jsonLine: string | undefined;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim().startsWith("{")) {
      jsonLine = lines[i];
      break;
    }
  }

  if (!jsonLine) {
    throw new Error("local faster-whisper 未返回有效转写结果");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonLine);
  } catch {
    throw new Error("local faster-whisper 未返回有效 JSON 结果");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("local faster-whisper 返回结果格式无效");
  }

  const response = parsed as { ok?: unknown; text?: unknown; error_code?: unknown; error?: unknown };
  if (response.ok === true) {
    const text = typeof response.text === "string" ? response.text.trim() : "";
    if (!text) throw new Error("语音未识别出文本");
    return text;
  }

  const error = typeof response.error === "string" && response.error.trim()
    ? response.error.trim()
    : "unknown error";
  if (response.error_code === "missing_faster_whisper") {
    throw new Error(`本机 Python 环境未安装 faster-whisper 或其依赖: ${error}`);
  }
  throw new Error(`local faster-whisper 转写失败: ${error}`);
}

async function transcribeWithLocalFasterWhisper(
  input: AudioTranscriptionInput,
  deps: Pick<AudioTranscriptionDeps, "runFfmpeg" | "runProcess"> = {},
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "miniclaw-audio-local-"));
  const inputPath = join(dir, `input${safeAudioInputExt(input.filename)}`);
  const wavPath = join(dir, "input.wav");
  const timeoutMs = config.audioTranscription.timeoutMs;

  try {
    await writeFile(inputPath, input.buffer);
    await (deps.runFfmpeg ?? runFfmpeg)([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      wavPath,
    ], {
      runProcess: deps.runProcess,
      timeoutMs,
      notFoundMessage: "local faster-whisper 语音转写需要本机 ffmpeg，但当前找不到 ffmpeg",
    });

    const runner = deps.runProcess ?? runProcess;
    const output = await runner(config.audioTranscription.localPython, [
      "-c",
      LOCAL_FASTER_WHISPER_SCRIPT,
      wavPath,
      config.audioTranscription.localModel,
      config.audioTranscription.localDevice,
      config.audioTranscription.localComputeType,
      config.audioTranscription.language ?? "",
    ], {
      timeoutMs,
      notFoundMessage: `找不到 Python 解释器 ${config.audioTranscription.localPython}，无法运行 local faster-whisper`,
      failureLabel: "local faster-whisper",
    });

    return parseLocalFasterWhisperOutput(output.stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function transcribeAudio(
  input: AudioTranscriptionInput,
  deps: AudioTranscriptionDeps = {},
): Promise<AudioTranscriptionResult> {
  if (!config.audioTranscription.enabled) {
    throw new Error("语音转写未启用");
  }

  const maxBytes = config.audioTranscription.maxMb * 1024 * 1024;
  if (input.size > maxBytes) {
    throw new Error(`超过语音转写 ${config.audioTranscription.maxMb}MB 上限`);
  }

  const provider = resolveProvider();
  if (provider === "openai" || provider === "openai_compatible") {
    return transcribeWithOpenAiApi(input, provider, deps);
  }

  const text = await (deps.transcribeWithLocalFasterWhisper ?? ((audio) => transcribeWithLocalFasterWhisper(audio, deps)))(input);
  return {
    text,
    model: `local_faster_whisper:${config.audioTranscription.localModel}`,
  };
}

export const __testables = {
  audioContentType,
  convertedWebmName,
  convertOggToWebm,
  extractTranscriptText,
  openaiBaseUrl,
  parseLocalFasterWhisperOutput,
  prepareAudioUpload,
  resolveProvider,
  runFfmpeg,
  runProcess,
  safeAudioInputExt,
  shouldConvertOgg,
  transcribeWithLocalFasterWhisper,
  truncateErrorBody,
};
