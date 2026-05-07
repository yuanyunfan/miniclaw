import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { codexThreadOptions, getCodexClient, withCodexTimeout } from "../agent/codex.js";
import type { LlmRouteClassifier, RouteDecision, RouteIntent } from "./intent.js";

const VALID_INTENTS = new Set<RouteIntent>(["chat", "task_suggest", "task_confirm", "task_auto", "ignore"]);

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

function classifierPrompt(content: string, heuristic: RouteDecision): string {
  return [
    "Classify a Discord message for MiniClaw routing. Output JSON only.",
    "",
    "Intent meanings:",
    "- chat: read-only Q&A, explanation, analysis, pure-text summary, or ordinary static-web URL summary.",
    "- task_suggest: ambiguous; task mode may help but chat can still answer.",
    "- task_confirm: likely needs file edits, commands, tests, git, deployment, or long-running work.",
    "- task_auto: only if the prompt itself is clearly executable task work; runtime policy decides whether auto is allowed.",
    "- ignore: should not respond.",
    "",
    "URL rules:",
    "- Static public webpage summary can stay chat when it is likely one quick fetch.",
    "- mp.weixin.qq.com, WeChat public-account articles, login/cookie pages, anti-bot pages, dynamic pages, or browser-required pages should be task_suggest.",
    "- Explicit fetch/crawl/collect/monitor/save/export/write-to-file/Obsidian note requests should be task_confirm.",
    "",
    "Be conservative. Prefer chat or task_suggest when unsure. Do not invent facts.",
    "",
    `Heuristic: ${JSON.stringify(heuristic)}`,
    "",
    `<message>\n${content.slice(0, 4000)}\n</message>`,
    "",
    `Return exactly:
{"intent":"chat|task_suggest|task_confirm|task_auto|ignore","confidence":0.0,"reason":"short reason","riskFlags":["writes_files"]}`,
  ].join("\n");
}

function textFromAnthropicContent(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function parseDecisionJson(text: string): RouteDecision {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("LLM classifier did not return JSON");
  const raw = JSON.parse(match[0]) as {
    intent?: unknown;
    confidence?: unknown;
    reason?: unknown;
    riskFlags?: unknown;
    matchedSignals?: unknown;
  };

  const intent = typeof raw.intent === "string" && VALID_INTENTS.has(raw.intent as RouteIntent)
    ? raw.intent as RouteIntent
    : undefined;
  if (!intent) throw new Error(`Invalid classifier intent: ${String(raw.intent)}`);

  const confidence = typeof raw.confidence === "number" ? raw.confidence : Number(raw.confidence);
  const riskFlags = Array.isArray(raw.riskFlags)
    ? raw.riskFlags.filter((v): v is string => typeof v === "string")
    : [];
  const matchedSignals = Array.isArray(raw.matchedSignals)
    ? raw.matchedSignals.filter((v): v is string => typeof v === "string")
    : ["llm_classifier"];

  return {
    intent,
    confidence: Number.isFinite(confidence) ? confidence : 0.5,
    reason: typeof raw.reason === "string" ? raw.reason : "LLM classifier decision",
    matchedSignals,
    riskFlags,
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
    return parseDecisionJson(textFromAnthropicContent(msg.content));
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
    return parseDecisionJson(text);
  } finally {
    if (!timeoutCtrl.signal.aborted) timeoutCtrl.abort();
  }
};

export const __testables = { parseDecisionJson, classifierPrompt };
