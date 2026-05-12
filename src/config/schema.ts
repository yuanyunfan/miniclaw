import { z } from "zod";
import type {
  AgentProvider,
  AudioTranscriptionProvider,
  ClaudeSettingSource,
  CodexApprovalPolicy,
  CodexReasoningEffort,
  CodexSandboxMode,
  CodexWebSearchMode,
  ConfigObject,
  ModelClientId,
  SmartRouterClassifierProvider,
  SmartRouterDefaultMode,
} from "./types.js";

export const agentProviderValues = ["claude", "codex"] as const satisfies readonly AgentProvider[];
export const codexSandboxModeValues = ["read-only", "workspace-write", "danger-full-access"] as const satisfies readonly CodexSandboxMode[];
export const codexApprovalPolicyValues = ["never", "on-request", "on-failure", "untrusted"] as const satisfies readonly CodexApprovalPolicy[];
export const codexReasoningEffortValues = ["minimal", "low", "medium", "high", "xhigh"] as const satisfies readonly CodexReasoningEffort[];
export const codexWebSearchModeValues = ["disabled", "cached", "live"] as const satisfies readonly CodexWebSearchMode[];
export const claudeSettingSourceValues = ["user", "project", "local"] as const satisfies readonly ClaudeSettingSource[];
export const smartRouterDefaultModeValues = ["suggest", "confirm", "auto"] as const satisfies readonly SmartRouterDefaultMode[];
export const smartRouterClassifierProviderValues = ["auto", "raven", "anthropic", "openai", "openai_compatible", "codex"] as const satisfies readonly SmartRouterClassifierProvider[];
export const modelClientValues = smartRouterClassifierProviderValues satisfies readonly ModelClientId[];
export const audioTranscriptionProviderValues = ["auto", "openai", "openai_compatible", "local_faster_whisper"] as const satisfies readonly AudioTranscriptionProvider[];

const rawConfigObjectSchema = z.record(z.string(), z.unknown());

export function isPlainObject(v: unknown): v is ConfigObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseRawConfigObject(value: unknown, path: string): ConfigObject {
  const parsed = rawConfigObjectSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`MiniClaw config must be a YAML object: ${path}`);
  }
  return parsed.data;
}
