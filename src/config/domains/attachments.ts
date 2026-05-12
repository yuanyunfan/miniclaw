import type { ConfigReader } from "../env.js";
import { audioTranscriptionProviderValues } from "../schema.js";
import type { AudioTranscriptionProvider } from "../types.js";

export function buildAttachmentRuntimeConfig(reader: ConfigReader) {
  return {
    maxAttachmentMb: reader.positiveNumber(["attachments", "max_mb"], "MINICLAW_MAX_ATTACHMENT_MB", 32),
    maxAttachments: reader.positiveInt(["attachments", "max_count"], "MINICLAW_MAX_ATTACHMENTS", 10),
    audioTranscription: {
      enabled: reader.boolValue(
        ["attachments", "audio_transcription", "enabled"],
        "MINICLAW_AUDIO_TRANSCRIPTION_ENABLED",
        true
      ),
      provider: reader.oneOf<AudioTranscriptionProvider>(
        ["attachments", "audio_transcription", "provider"],
        "MINICLAW_AUDIO_TRANSCRIPTION_PROVIDER",
        "auto",
        audioTranscriptionProviderValues
      ),
      model: reader.requiredString(
        ["attachments", "audio_transcription", "model"],
        "MINICLAW_AUDIO_TRANSCRIPTION_MODEL",
        "gpt-4o-mini-transcribe"
      ),
      localModel: reader.requiredString(
        ["attachments", "audio_transcription", "local_model"],
        "MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_MODEL",
        "base"
      ),
      localPython: reader.requiredString(
        ["attachments", "audio_transcription", "local_python"],
        "MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_PYTHON",
        "python3"
      ),
      localDevice: reader.requiredString(
        ["attachments", "audio_transcription", "local_device"],
        "MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_DEVICE",
        "cpu"
      ),
      localComputeType: reader.requiredString(
        ["attachments", "audio_transcription", "local_compute_type"],
        "MINICLAW_AUDIO_TRANSCRIPTION_LOCAL_COMPUTE_TYPE",
        "int8"
      ),
      maxMb: reader.positiveNumber(
        ["attachments", "audio_transcription", "max_mb"],
        "MINICLAW_AUDIO_TRANSCRIPTION_MAX_MB",
        25
      ),
      timeoutMs: reader.positiveNumber(
        ["attachments", "audio_transcription", "timeout_ms"],
        "MINICLAW_AUDIO_TRANSCRIPTION_TIMEOUT_MS",
        120_000
      ),
      language: reader.optionalString(
        ["attachments", "audio_transcription", "language"],
        "MINICLAW_AUDIO_TRANSCRIPTION_LANGUAGE"
      ),
    },
  } as const;
}
