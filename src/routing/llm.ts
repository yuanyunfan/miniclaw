import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { codexThreadOptions, getCodexClient, withCodexTimeout } from "../agent/codex.js";
import type { EstimatedEffort, LlmRouteClassifier, RouteCapabilityDecision } from "./intent.js";

const VALID_EFFORTS = new Set<EstimatedEffort>(["short", "medium", "long"]);

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    if (!config.anthropicApiKey) throw new Error("Anthropic API key is not configured");
    anthropicClient = new Anthropic({
      apiKey: config.anthropicApiKey,
      ...(config.anthropicBaseUrl ? { baseURL: config.anthropicBaseUrl } : {}),
    });
  }
  return anthropicClient;
}

function classifierPrompt(content: string, heuristic: RouteCapabilityDecision): string {
  return [
    "Classify the capabilities needed to handle a Discord message for MiniClaw. Output JSON only.",
    "",
    "Do not answer the user's request. Do not browse, fetch URLs, inspect files, or run tools.",
    "Only judge which capabilities would be needed if MiniClaw handled the request.",
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
    "",
    "Routing policy is NOT your job. MiniClaw will map capabilities to chat/task locally.",
    "Be conservative about write/shell/git capabilities, but do not mark every analytical question as multi-step research.",
    "A pure concept explanation or short read-only answer should keep all capability booleans false.",
    "",
    `Heuristic capability hints: ${JSON.stringify(heuristic)}`,
    "",
    `<message>\n${content.slice(0, 4000)}\n</message>`,
    "",
    `Return exactly:
{"needs_current_info":false,"needs_multi_step_research":false,"needs_file_write":false,"needs_shell":false,"needs_git":false,"needs_browser":false,"needs_runtime_inspection":false,"needs_long_running":false,"creates_persistent_output":false,"has_external_url":false,"has_attachments":false,"estimated_effort":"short|medium|long","confidence":0.0,"reason":"short reason","evidence":["short signal"],"risk_flags":["short_risk"]}`,
  ].join("\n");
}

function textFromAnthropicContent(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
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
    estimatedEffort,
    confidence: Number.isFinite(confidence) ? confidence : 0.5,
    reason: typeof raw.reason === "string" ? raw.reason : "LLM capability classifier decision",
    evidence,
    matchedSignals: [...new Set([...evidence, "llm_classifier"])],
    riskFlags,
    lockedCapabilities: [],
  };
}

export const classifyRouteWithLlm: LlmRouteClassifier = async (input, heuristic) => {
  const prompt = classifierPrompt(input.content, heuristic);

  if (config.agentProvider === "claude") {
    const msg = await getAnthropicClient().messages.create({
      model: config.claudeModel,
      max_tokens: 500,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });
    return parseCapabilityJson(textFromAnthropicContent(msg.content));
  }

  const codex = getCodexClient();
  const opts = {
    ...codexThreadOptions("chat", config.defaultCwd),
    sandboxMode: "read-only" as const,
    approvalPolicy: "never" as const,
    webSearchMode: "disabled" as const,
    networkAccessEnabled: false,
  };
  const thread = codex.startThread(opts);
  const ctrl = new AbortController();
  const timeoutCtrl = withCodexTimeout(ctrl.signal, Math.min(config.chatTimeoutMs, 30_000));

  try {
    const { events } = await thread.runStreamed(prompt, { signal: timeoutCtrl.signal });
    let text = "";
    for await (const event of events) {
      if (event.type === "turn.failed") throw new Error(event.error.message);
      if (event.type === "error") throw new Error(event.message);
      if ((event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") && event.item.type === "agent_message") {
        text = event.item.text;
      }
    }
    return parseCapabilityJson(text);
  } finally {
    if (!timeoutCtrl.signal.aborted) timeoutCtrl.abort();
  }
};

export const __testables = { parseCapabilityJson, classifierPrompt };
