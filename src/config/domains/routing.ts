import type { ConfigReader } from "../env.js";
import { channelDefaults } from "../resolve.js";
import {
  smartRouterClassifierProviderValues,
  smartRouterDefaultModeValues,
} from "../schema.js";
import type { SmartRouterClassifierProvider, SmartRouterDefaultMode } from "../types.js";

export function buildRoutingRuntimeConfig(reader: ConfigReader) {
  return {
    autoReplyChannelIds: reader.stringArray(["routing", "auto_reply_channels"], "MINICLAW_AUTO_REPLY_CHANNELS", ["*"]),
    taskChannelIds: reader.stringArray(["routing", "task_channels"], "MINICLAW_TASK_CHANNELS"),
    channelDefaults: channelDefaults(reader, ["routing", "channel_defaults"], []),
    smartRouter: {
      enabled: reader.boolValue(["routing", "smart_router", "enabled"], "MINICLAW_SMART_ROUTER_ENABLED", false),
      defaultMode: reader.oneOf<SmartRouterDefaultMode>(
        ["routing", "smart_router", "default_mode"],
        "MINICLAW_SMART_ROUTER_DEFAULT_MODE",
        "confirm",
        smartRouterDefaultModeValues
      ),
      minConfirmConfidence: reader.confidenceNumber(
        ["routing", "smart_router", "min_confirm_confidence"],
        "MINICLAW_SMART_ROUTER_MIN_CONFIRM_CONFIDENCE",
        0.55
      ),
      minAutoConfidence: reader.confidenceNumber(
        ["routing", "smart_router", "min_auto_confidence"],
        "MINICLAW_SMART_ROUTER_MIN_AUTO_CONFIDENCE",
        0.9
      ),
      confirmChannelIds: reader.stringArray(
        ["routing", "smart_router", "confirm_channels"],
        "MINICLAW_SMART_ROUTER_CONFIRM_CHANNELS"
      ),
      autoTaskChannelIds: reader.stringArray(
        ["routing", "smart_router", "auto_task_channels"],
        "MINICLAW_SMART_ROUTER_AUTO_TASK_CHANNELS"
      ),
      llmClassifier: {
        enabled: reader.boolValue(
          ["routing", "smart_router", "llm_classifier", "enabled"],
          "MINICLAW_SMART_ROUTER_LLM_ENABLED",
          true
        ),
        onlyWhenAmbiguous: reader.boolValue(
          ["routing", "smart_router", "llm_classifier", "only_when_ambiguous"],
          "MINICLAW_SMART_ROUTER_LLM_ONLY_WHEN_AMBIGUOUS",
          true
        ),
        provider: reader.oneOf<SmartRouterClassifierProvider>(
          ["routing", "smart_router", "llm_classifier", "provider"],
          "MINICLAW_SMART_ROUTER_LLM_PROVIDER",
          "auto",
          smartRouterClassifierProviderValues
        ),
        model: reader.stringOrInherit(
          ["routing", "smart_router", "llm_classifier", "model"],
          "MINICLAW_SMART_ROUTER_LLM_MODEL",
          "inherit"
        ),
        timeoutMs: reader.positiveNumber(
          ["routing", "smart_router", "llm_classifier", "timeout_ms"],
          "MINICLAW_SMART_ROUTER_LLM_TIMEOUT_MS",
          8_000
        ),
        fallbackToCodex: reader.boolValue(
          ["routing", "smart_router", "llm_classifier", "fallback_to_codex"],
          "MINICLAW_SMART_ROUTER_LLM_FALLBACK_TO_CODEX",
          false
        ),
      },
      confirmation: {
        state: reader.oneOf<"memory">(
          ["routing", "smart_router", "confirmation", "state"],
          "MINICLAW_SMART_ROUTER_CONFIRMATION_STATE",
          "memory",
          ["memory"]
        ),
        timeoutSeconds: reader.positiveInt(
          ["routing", "smart_router", "confirmation", "timeout_seconds"],
          "MINICLAW_SMART_ROUTER_CONFIRMATION_TIMEOUT_SECONDS",
          600
        ),
      },
      context: {
        includeRecentWhenReferenced: reader.boolValue(
          ["routing", "smart_router", "context", "include_recent_when_referenced"],
          "MINICLAW_SMART_ROUTER_CONTEXT_INCLUDE_RECENT_WHEN_REFERENCED",
          true
        ),
        recentTurns: reader.positiveInt(
          ["routing", "smart_router", "context", "recent_turns"],
          "MINICLAW_SMART_ROUTER_CONTEXT_RECENT_TURNS",
          6
        ),
        maxChars: reader.positiveInt(
          ["routing", "smart_router", "context", "max_chars"],
          "MINICLAW_SMART_ROUTER_CONTEXT_MAX_CHARS",
          8000
        ),
      },
      decisionLog: {
        enabled: reader.boolValue(
          ["routing", "smart_router", "decision_log", "enabled"],
          "MINICLAW_SMART_ROUTER_DECISION_LOG_ENABLED",
          true
        ),
        store: reader.oneOf<"sqlite">(
          ["routing", "smart_router", "decision_log", "store"],
          "MINICLAW_SMART_ROUTER_DECISION_LOG_STORE",
          "sqlite",
          ["sqlite"]
        ),
        promptPreviewChars: reader.positiveInt(
          ["routing", "smart_router", "decision_log", "prompt_preview_chars"],
          "MINICLAW_SMART_ROUTER_DECISION_LOG_PROMPT_PREVIEW_CHARS",
          160
        ),
        storeFullPrompt: reader.boolValue(
          ["routing", "smart_router", "decision_log", "store_full_prompt"],
          "MINICLAW_SMART_ROUTER_DECISION_LOG_STORE_FULL_PROMPT",
          false
        ),
      },
    },
  } as const;
}
