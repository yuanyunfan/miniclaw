import type { SmartRouterDefaultMode } from "../config.js";

export type RouteIntent = "chat" | "task_suggest" | "task_confirm" | "task_auto" | "ignore";
export type EstimatedEffort = "short" | "medium" | "long";

export interface RouteDecision {
  intent: RouteIntent;
  confidence: number;
  reason: string;
  matchedSignals: string[];
  riskFlags: string[];
  capabilities?: RouteCapabilityDecision;
}

export interface RouteCapabilityDecision {
  needsCurrentInfo: boolean;
  needsMultiStepResearch: boolean;
  needsFileWrite: boolean;
  needsShell: boolean;
  needsGit: boolean;
  needsBrowser: boolean;
  needsRuntimeInspection: boolean;
  needsLongRunning: boolean;
  createsPersistentOutput: boolean;
  hasExternalUrl: boolean;
  hasAttachments: boolean;
  isUrlOnly: boolean;
  estimatedEffort: EstimatedEffort;
  confidence: number;
  reason: string;
  evidence: string[];
  matchedSignals: string[];
  riskFlags: string[];
  userIntent?: string;
  ambiguity?: string;
}

export interface RouteClassifierInput {
  content: string;
  channelId: string;
  hasAttachments?: boolean;
}

export interface SmartRouterPolicy {
  enabled: boolean;
  defaultMode: SmartRouterDefaultMode;
  minConfirmConfidence: number;
  minAutoConfidence: number;
  confirmChannelIds: readonly string[];
  autoTaskChannelIds: readonly string[];
  llmClassifier: {
    enabled: boolean;
    onlyWhenAmbiguous: boolean;
  };
}

export type LlmRouteClassifier = (
  input: RouteClassifierInput
) => Promise<RouteCapabilityDecision>;

const CAPABILITY_NAMES = [
  "needsCurrentInfo",
  "needsMultiStepResearch",
  "needsFileWrite",
  "needsShell",
  "needsGit",
  "needsBrowser",
  "needsRuntimeInspection",
  "needsLongRunning",
  "createsPersistentOutput",
] as const;

export type RouteCapabilityName = typeof CAPABILITY_NAMES[number];

const URL_PATTERN = /https?:\/\/[^\s<>"'`，。！？、)）]+/i;
const URL_PATTERN_GLOBAL = /https?:\/\/[^\s<>"'`，。！？、)）]+/gi;
const STRUCTURAL_URL_LABEL_PATTERN = /^(?:链接|link|url)\s*[:：]?\s*$/i;
const HIGH_RISK_CAPABILITIES = new Set<RouteCapabilityName>([
  "needsFileWrite",
  "needsShell",
  "needsGit",
  "needsRuntimeInspection",
  "createsPersistentOutput",
]);
const SOFT_TASK_CAPABILITIES = new Set<RouteCapabilityName>([
  "needsCurrentInfo",
  "needsMultiStepResearch",
  "needsBrowser",
  "needsLongRunning",
]);

function effortRank(effort: EstimatedEffort): number {
  if (effort === "long") return 3;
  if (effort === "medium") return 2;
  return 1;
}

function maxEffort(a: EstimatedEffort, b: EstimatedEffort): EstimatedEffort {
  return effortRank(a) >= effortRank(b) ? a : b;
}

function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, Number(n.toFixed(2))));
}

function emptyCapabilities(overrides: Partial<RouteCapabilityDecision> = {}): RouteCapabilityDecision {
  return {
    needsCurrentInfo: false,
    needsMultiStepResearch: false,
    needsFileWrite: false,
    needsShell: false,
    needsGit: false,
    needsBrowser: false,
    needsRuntimeInspection: false,
    needsLongRunning: false,
    createsPersistentOutput: false,
    hasExternalUrl: false,
    hasAttachments: false,
    isUrlOnly: false,
    estimatedEffort: "short",
    confidence: 0.5,
    reason: "no task capability found",
    evidence: [],
    matchedSignals: [],
    riskFlags: [],
    ...overrides,
  };
}

function highRiskCapabilities(decision: RouteCapabilityDecision): RouteCapabilityName[] {
  return CAPABILITY_NAMES.filter((name) => HIGH_RISK_CAPABILITIES.has(name) && decision[name]);
}

function softTaskCapabilities(decision: RouteCapabilityDecision): RouteCapabilityName[] {
  return CAPABILITY_NAMES.filter((name) => SOFT_TASK_CAPABILITIES.has(name) && decision[name]);
}

function channelListMatches(channelIds: readonly string[], channelId: string): boolean {
  return channelIds.length === 0 || channelIds.includes("*") || channelIds.includes(channelId);
}

function buildReason(decision: RouteCapabilityDecision): string {
  const highRisk = highRiskCapabilities(decision);
  if (highRisk.length) return `message requires task-only capabilities: ${highRisk.join(", ")}`;
  const soft = softTaskCapabilities(decision);
  if (soft.length) return `message may need task-mode capabilities: ${soft.join(", ")}`;
  if (decision.isUrlOnly) return "message only contains a URL and needs user intent clarification";
  return decision.reason || "no task capability found";
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => Boolean(value.trim())))];
}

function contentWithoutUrls(content: string): string {
  return content
    .replace(URL_PATTERN_GLOBAL, "")
    .replace(/[<>()（）\[\]【】"'`，。！？、\s]+/g, " ")
    .trim();
}

function isUrlOnlyContent(content: string, hasExternalUrl: boolean): boolean {
  if (!hasExternalUrl) return false;
  const rest = contentWithoutUrls(content);
  return !rest || STRUCTURAL_URL_LABEL_PATTERN.test(rest);
}

export function classifyMessageCapabilities(input: RouteClassifierInput): RouteCapabilityDecision {
  const content = input.content.trim();
  const hasAttachments = Boolean(input.hasAttachments);
  const hasExternalUrl = URL_PATTERN.test(content);
  const isUrlOnly = isUrlOnlyContent(content, hasExternalUrl);
  const evidence = uniqueStrings([
    hasExternalUrl ? "external_url" : "",
    isUrlOnly ? "url_only" : "",
    hasAttachments ? "attachments" : "",
    !content && !hasAttachments ? "empty_message" : "",
  ]);

  if (!content && !hasAttachments) {
    return emptyCapabilities({
      hasExternalUrl,
      hasAttachments,
      isUrlOnly,
      confidence: 0.9,
      reason: "empty message without attachments",
      evidence,
      matchedSignals: evidence,
    });
  }

  return emptyCapabilities({
    hasExternalUrl,
    hasAttachments,
    isUrlOnly,
    confidence: isUrlOnly ? 0.62 : 0.5,
    reason: isUrlOnly
      ? "message only contains a URL and needs user intent clarification"
      : "objective message facts only; semantic capabilities require LLM classification",
    evidence,
    matchedSignals: evidence,
  });
}

export function resolveCapabilitiesToRouteDecision(capabilities: RouteCapabilityDecision): RouteDecision {
  const highRisk = highRiskCapabilities(capabilities);
  let intent: RouteIntent = "chat";
  let confidence = capabilities.confidence;
  let reason = buildReason(capabilities);

  if (highRisk.length) {
    intent = "task_confirm";
    confidence = Math.max(confidence, 0.72);
  } else if (
    softTaskCapabilities(capabilities).length ||
    capabilities.isUrlOnly
  ) {
    intent = "task_suggest";
    confidence = Math.max(confidence, 0.52);
  }

  return {
    intent,
    confidence: clampConfidence(confidence),
    reason,
    matchedSignals: capabilities.matchedSignals,
    riskFlags: capabilities.riskFlags,
    capabilities,
  };
}

export function classifyMessageIntent(input: RouteClassifierInput): RouteDecision {
  return resolveCapabilitiesToRouteDecision(classifyMessageCapabilities(input));
}

export function shouldUseCapabilityClassifier(decision: RouteCapabilityDecision, policy: SmartRouterPolicy): boolean {
  if (!policy.enabled || !policy.llmClassifier.enabled) return false;
  return !(decision.evidence.includes("empty_message") && !decision.hasAttachments);
}

export function shouldUseLlmClassifier(decision: RouteDecision, policy: SmartRouterPolicy): boolean {
  if (decision.capabilities) return shouldUseCapabilityClassifier(decision.capabilities, policy);
  if (!policy.enabled || !policy.llmClassifier.enabled) return false;
  return true;
}

export function mergeCapabilityDecisions(
  baseline: RouteCapabilityDecision,
  llm: RouteCapabilityDecision
): RouteCapabilityDecision {
  const merged = emptyCapabilities({
    ...llm,
    confidence: clampConfidence(llm.confidence),
    evidence: [...new Set([...baseline.evidence, ...llm.evidence, "llm_classifier"])],
    matchedSignals: [...new Set([...baseline.matchedSignals, ...llm.matchedSignals, "llm_classifier"])],
    riskFlags: [...new Set([...baseline.riskFlags, ...llm.riskFlags])],
    hasExternalUrl: baseline.hasExternalUrl || llm.hasExternalUrl,
    hasAttachments: baseline.hasAttachments || llm.hasAttachments,
    isUrlOnly: baseline.isUrlOnly || llm.isUrlOnly,
    estimatedEffort: maxEffort(baseline.estimatedEffort, llm.estimatedEffort),
    reason: llm.reason || baseline.reason,
  });

  for (const capability of CAPABILITY_NAMES) {
    merged[capability] = Boolean(llm[capability]);
  }

  return merged;
}

function withClassifierFailure(
  capabilities: RouteCapabilityDecision,
  riskFlag: "classifier_failed" | "classifier_unavailable"
): RouteCapabilityDecision {
  return {
    ...capabilities,
    confidence: Math.min(capabilities.confidence, 0.5),
    reason: `${riskFlag}; ${capabilities.reason}`,
    evidence: uniqueStrings([...capabilities.evidence, riskFlag]),
    matchedSignals: uniqueStrings([...capabilities.matchedSignals, riskFlag]),
    riskFlags: uniqueStrings([...capabilities.riskFlags, riskFlag]),
  };
}

export async function classifySmartRoute(
  input: RouteClassifierInput,
  policy: SmartRouterPolicy,
  llmClassifier?: LlmRouteClassifier
): Promise<RouteDecision> {
  const baseline = classifyMessageCapabilities(input);
  let capabilities = baseline;

  if (shouldUseCapabilityClassifier(baseline, policy)) {
    if (!llmClassifier) {
      capabilities = withClassifierFailure(baseline, "classifier_unavailable");
      return resolveCapabilitiesToRouteDecision(capabilities);
    }

    try {
      const llm = await llmClassifier(input);
      capabilities = mergeCapabilityDecisions(baseline, llm);
    } catch {
      capabilities = withClassifierFailure(baseline, "classifier_failed");
    }
  }

  return resolveCapabilitiesToRouteDecision(capabilities);
}

export function resolveSmartRouterAction(
  decision: RouteDecision,
  policy: SmartRouterPolicy,
  channelId: string,
  options: { wasMentioned?: boolean } = {}
): RouteDecision {
  if (!policy.enabled) {
    return { ...decision, intent: "chat", reason: "smart router disabled" };
  }
  if (decision.intent === "ignore" || decision.intent === "chat") return decision;

  const isAutoTaskChannel = policy.autoTaskChannelIds.includes(channelId);
  if (
    isAutoTaskChannel &&
    decision.confidence >= policy.minAutoConfidence &&
    (decision.intent === "task_auto" ||
      policy.defaultMode === "auto" ||
      decision.intent === "task_confirm")
  ) {
    return { ...decision, intent: "task_auto", reason: `${decision.reason}; trusted auto-task channel` };
  }

  const confirmAllowed =
    options.wasMentioned === true ||
    channelListMatches(policy.confirmChannelIds, channelId);
  if (!confirmAllowed) {
    return {
      ...decision,
      intent: "chat",
      reason: `${decision.reason}; channel is not configured for smart-router confirmation`,
    };
  }

  const confidenceCanPromote = decision.capabilities === undefined && decision.confidence >= policy.minConfirmConfidence;
  if (decision.intent === "task_confirm" || confidenceCanPromote) {
    return { ...decision, intent: "task_confirm" };
  }

  return { ...decision, intent: "task_suggest" };
}
