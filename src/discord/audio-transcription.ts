import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { config } from "../config.js";

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

interface AudioTranscriptionDeps {
  fetchFn?: typeof fetch;
  convertOggToWebm?: (input: AudioTranscriptionInput) => Promise<AudioUpload>;
}

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const MAX_ERROR_BODY_CHARS = 500;

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

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("Discord .ogg 语音需要 ffmpeg 转成 webm 后再转写，但当前找不到 ffmpeg"));
        return;
      }
      reject(err);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg audio conversion failed${stderr.trim() ? `: ${stderr.trim()}` : ` with code ${code}`}`));
    });
  });
}

async function convertOggToWebm(input: AudioTranscriptionInput): Promise<AudioUpload> {
  const dir = await mkdtemp(join(tmpdir(), "miniclaw-audio-"));
  const inputPath = join(dir, "input.ogg");
  const outputName = convertedWebmName(input.filename);
  const outputPath = join(dir, outputName);

  try {
    await writeFile(inputPath, input.buffer);
    await runFfmpeg([
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
    ]);
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
    return (deps.convertOggToWebm ?? convertOggToWebm)(input);
  }

  return {
    buffer: input.buffer,
    filename: input.filename,
    contentType: input.contentType,
  };
}

export async function transcribeAudio(
  input: AudioTranscriptionInput,
  deps: AudioTranscriptionDeps = {},
): Promise<AudioTranscriptionResult> {
  if (!config.audioTranscription.enabled) {
    throw new Error("语音转写未启用");
  }

  if (!config.openaiApiKey) {
    throw new Error("缺少 OPENAI_API_KEY，无法调用 OpenAI Audio Transcriptions API");
  }

  const maxBytes = config.audioTranscription.maxMb * 1024 * 1024;
  if (input.size > maxBytes) {
    throw new Error(`超过语音转写 ${config.audioTranscription.maxMb}MB 上限`);
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

  const response = await (deps.fetchFn ?? fetch)(`${openaiBaseUrl()}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const body = truncateErrorBody(await response.text().catch(() => ""));
    throw new Error(`OpenAI transcription HTTP ${response.status}${body ? `: ${body}` : ""}`);
  }

  const text = extractTranscriptText(await response.json());
  if (!text) {
    throw new Error("OpenAI transcription response did not include text");
  }

  return { text, model: config.audioTranscription.model };
}

export const __testables = {
  audioContentType,
  convertedWebmName,
  convertOggToWebm,
  extractTranscriptText,
  openaiBaseUrl,
  prepareAudioUpload,
  shouldConvertOgg,
  truncateErrorBody,
};
