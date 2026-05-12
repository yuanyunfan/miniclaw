import { config } from "../config.js";
import type { ModelClient } from "../runtime/model-client.js";
import {
  createAnthropicMessagesModelClient,
  createCodexThreadModelClient,
  createOpenAiChatModelClient,
  type AnthropicMessagesModelClientOptions,
  type OpenAiChatModelClientOptions,
} from "../runtime/model-client-adapters.js";
import type { EstimatedEffort, LlmRouteClassifier, RouteCapabilityDecision, RouteClassifierInput } from "./intent.js";

const VALID_EFFORTS = new Set<EstimatedEffort>(["short", "medium", "long"]);
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

type OpenAiClassifierProvider = "openai" | "openai_compatible";
type ApiClassifierProvider = "anthropic" | OpenAiClassifierProvider;

type AnthropicClassifierOptions = Omit<AnthropicMessagesModelClientOptions, "id">;
type OpenAiChatClassifierOptions = Omit<OpenAiChatModelClientOptions, "id">;

function classifierPrompt(input: RouteClassifierInput): string {
  const content = input.content.trim();
  return [
    "Classify the capabilities needed to handle a Discord message for MiniClaw. Output JSON only.",
    "",
    "Do not answer the user's request. Do not browse, fetch URLs, inspect files, or run tools.",
    "Only judge which capabilities would be needed if MiniClaw handled the request.",
    "Do not use keyword matching. Infer the user's actual intent from the full message, including incomplete or conversational wording.",
    "",
    "Capability meanings:",
    "- needs_current_info: requires current or recently changed information, such as today's GitHub activity, latest releases, prices, news, or schedules.",
    "- needs_multi_step_research: likely needs multiple lookups, comparison, synthesis, repo inspection, log/DB inspection, or non-trivial investigation.",
    "- needs_file_write: likely needs creating, editing, deleting, or persisting files/docs/code.",
    "- needs_shell: likely needs running commands, tests, builds, scripts, service restarts, deployments, or local probes.",
    "- needs_git: likely needs commit, push, merge, rebase, branch, or other Git state changes.",
    "- needs_browser: likely needs browser/login/cookie/dynamic page/anti-bot handling.",
    "- needs_runtime_inspection: likely needs checking logs, DB, process state, task history, or local runtime status.",
    "- needs_long_running: likely exceeds a quick chat answer because it needs many steps, long execution, or durable work.",
    "- creates_persistent_output: likely creates durable artifacts such as files, notes, reports, docs, or scheduled outputs.",
    "- has_external_url: message contains an external URL.",
    "- has_attachments: message has Discord attachments.",
    "- is_url_only: message contains only URL/link text without enough task intent.",
    "",
    "Routing policy is NOT your job. MiniClaw will map capabilities to chat/task locally.",
    "Be conservative about write/shell/git capabilities, but do not miss implicit implementation requests.",
    "A pure concept explanation or short read-only answer should keep all capability booleans false.",
    "A named project/module change request such as 'X 中的 Y 要加个值/排序/调整展示' needs file or code changes even if the user does not say '修改' or '实现'.",
    "A named person's current contribution spike or project activity explanation usually needs current information and multi-step research, even if the user says '简单拆解'.",
    "",
    "Examples:",
    `- "steipete的1099 次贡献他是如何做到的？你能给我简单拆解一下吗？" => needs_current_info=true, needs_multi_step_research=true, estimated_effort="medium".`,
    `- "stock-pulse中的当前持仓盘中快照 盈利组/亏损组要在旁边加个总的日内盈亏的数值 盈利组/亏损组中要按照日内盈亏来排序" => needs_file_write=true, estimated_effort="medium".`,
    `- "GitHub contribution 是什么意思？" => all task capability booleans false.`,
    "",
    `<message has_attachments="${Boolean(input.hasAttachments)}">\n${content.slice(0, 4000)}\n</message>`,
    "",
    `Return exactly:
{"needs_current_info":false,"needs_multi_step_research":false,"needs_file_write":false,"needs_shell":false,"needs_git":false,"needs_browser":false,"needs_runtime_inspection":false,"needs_long_running":false,"creates_persistent_output":false,"has_external_url":false,"has_attachments":false,"is_url_only":false,"estimated_effort":"short|medium|long","confidence":0.0,"reason":"short reason","evidence":["short evidence"],"risk_flags":["short_risk"],"user_intent":"short intent","ambiguity":"none|low|medium|high"}`,
  ].join("\n");
}

function coerceBoolean(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") return raw.trim().toLowerCase() === "true";
  return Boolean(raw);
}

function getBoolean(raw: Record<string, unknown>, camel: string, snake: string): boolean {
  return coerceBoolean(raw[camel] ?? raw[snake] ?? false);
}

function stringArray(raw: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(raw)) return fallback;
  return raw.filter((v): v is string => typeof v === "string" && Boolean(v.trim()));
}

function parseCapabilityJson(text: string): RouteCapabilityDecision {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("LLM capability classifier did not return JSON");
  const raw = JSON.parse(match[0]) as Record<string, unknown>;

  const confidence = typeof raw.confidence === "number" ? raw.confidence : Number(raw.confidence);
  const estimatedEffortRaw = typeof raw.estimated_effort === "string"
    ? raw.estimated_effort
    : typeof raw.estimatedEffort === "string"
      ? raw.estimatedEffort
      : "short";
  const estimatedEffort = VALID_EFFORTS.has(estimatedEffortRaw as EstimatedEffort)
    ? estimatedEffortRaw as EstimatedEffort
    : "short";
  const evidence = stringArray(raw.evidence, ["llm_classifier"]);
  const riskFlags = stringArray(raw.risk_flags ?? raw.riskFlags);

  return {
    needsCurrentInfo: getBoolean(raw, "needsCurrentInfo", "needs_current_info"),
    needsMultiStepResearch: getBoolean(raw, "needsMultiStepResearch", "needs_multi_step_research"),
    needsFileWrite: getBoolean(raw, "needsFileWrite", "needs_file_write"),
    needsShell: getBoolean(raw, "needsShell", "needs_shell"),
    needsGit: getBoolean(raw, "needsGit", "needs_git"),
    needsBrowser: getBoolean(raw, "needsBrowser", "needs_browser"),
    needsRuntimeInspection: getBoolean(raw, "needsRuntimeInspection", "needs_runtime_inspection"),
    needsLongRunning: getBoolean(raw, "needsLongRunning", "needs_long_running"),
    createsPersistentOutput: getBoolean(raw, "createsPersistentOutput", "creates_persistent_output"),
    hasExternalUrl: getBoolean(raw, "hasExternalUrl", "has_external_url"),
    hasAttachments: getBoolean(raw, "hasAttachments", "has_attachments"),
    isUrlOnly: getBoolean(raw, "isUrlOnly", "is_url_only"),
    estimatedEffort,
    confidence: Number.isFinite(confidence) ? confidence : 0.5,
    reason: typeof raw.reason === "string" ? raw.reason : "LLM capability classifier decision",
    evidence,
    matchedSignals: [...new Set([...evidence, "llm_classifier"])],
    riskFlags,
    ...(typeof raw.user_intent === "string" ? { userIntent: raw.user_intent } : {}),
    ...(typeof raw.userIntent === "string" ? { userIntent: raw.userIntent } : {}),
    ...(typeof raw.ambiguity === "string" ? { ambiguity: raw.ambiguity } : {}),
  };
}

function resolveApiClassifierProvider(): ApiClassifierProvider | null {
  const provider = config.smartRouter.llmClassifier.provider;
  if (provider === "codex") return null;
  if (provider === "raven" || provider === "anthropic") return "anthropic";
  if (provider === "openai") return "openai";
  if (provider === "openai_compatible") return "openai_compatible";
  if (config.anthropicBaseUrl && config.anthropicApiKey) return "anthropic";
  if (config.openaiApiKey) return "openai";
  if (config.openaiBaseUrl) return "openai_compatible";
  if (config.agentProvider === "claude" && config.anthropicApiKey) return "anthropic";
  return null;
}

function classifierModelFor(provider: ApiClassifierProvider): string {
  const configured = config.smartRouter.llmClassifier.model;
  if (configured) return configured;
  return provider === "anthropic" ? config.claudeModel : OPENAI_DEFAULT_MODEL;
}

async function classifyRouteWithModelClient(
  input: RouteClassifierInput,
  client: ModelClient,
  options: { systemPrompt?: string } = {},
): Promise<RouteCapabilityDecision> {
  const prompt = classifierPrompt(input);
  const completionInput = {
    ...(options.systemPrompt
      ? {
          messages: [
            { role: "system" as const, content: options.systemPrompt },
            { role: "user" as const, content: prompt },
          ],
        }
      : { prompt }),
    temperature: 0,
    maxTokens: 500,
    responseFormat: "json" as const,
    metadata: {
      purpose: "smart_router_classifier",
      channelId: input.channelId,
      hasAttachments: Boolean(input.hasAttachments),
    },
    parse: parseCapabilityJson,
  };

  if (client.classify) {
    return client.classify(completionInput);
  }
  const result = await client.complete(completionInput);
  return parseCapabilityJson(result.text);
}

async function classifyRouteWithAnthropicMessages(
  input: RouteClassifierInput,
  options: AnthropicClassifierOptions,
): Promise<RouteCapabilityDecision> {
  return classifyRouteWithModelClient(input, createAnthropicMessagesModelClient({
    id: "smart-router-anthropic",
    ...options,
  }));
}

async function classifyRouteWithOpenAiChat(
  input: RouteClassifierInput,
  options: OpenAiChatClassifierOptions,
): Promise<RouteCapabilityDecision> {
  return classifyRouteWithModelClient(input, createOpenAiChatModelClient({
    id: `smart-router-${options.provider}`,
    ...options,
  }), {
    systemPrompt: "You classify MiniClaw smart-router capabilities. Return JSON only.",
  });
}

async function classifyRouteWithCodexThread(input: RouteClassifierInput): Promise<RouteCapabilityDecision> {
  return classifyRouteWithModelClient(input, createCodexThreadModelClient({
    id: "smart-router-codex",
    cwd: config.defaultCwd,
    timeoutMs: Math.min(config.chatTimeoutMs, 30_000),
  }));
}

export const classifyRouteWithLlm: LlmRouteClassifier = async (input) => {
  const apiProvider = resolveApiClassifierProvider();
  if (apiProvider) {
    try {
      const model = classifierModelFor(apiProvider);
      if (apiProvider === "anthropic") {
        return await classifyRouteWithAnthropicMessages(input, {
          model,
          timeoutMs: config.smartRouter.llmClassifier.timeoutMs,
          apiKey: config.anthropicApiKey,
          baseUrl: config.anthropicBaseUrl,
        });
      }
      return await classifyRouteWithOpenAiChat(input, {
        provider: apiProvider,
        model,
        timeoutMs: config.smartRouter.llmClassifier.timeoutMs,
        apiKey: config.openaiApiKey,
        baseUrl: config.openaiBaseUrl,
      });
    } catch (err) {
      if (!config.smartRouter.llmClassifier.fallbackToCodex) {
        throw err;
      }
    }
  }

  return classifyRouteWithCodexThread(input);
};

export const __testables = {
  parseCapabilityJson,
  classifierPrompt,
  classifyRouteWithModelClient,
  classifyRouteWithAnthropicMessages,
  classifyRouteWithOpenAiChat,
  classifyRouteWithCodexThread,
  resolveApiClassifierProvider,
  classifierModelFor,
};
