export type AgentRunManagerRouteMode = "off" | "force" | "auto";

export interface AgentRunManagerComplexityInput {
  prompt: string;
  hasAttachments?: boolean;
  resumeSessionId?: string;
}

export interface AgentRunManagerComplexityDecision {
  level: "low" | "medium" | "high";
  score: number;
  reasons: string[];
}

export interface AgentRunManagerRoutingConfig {
  enabled: boolean;
  autoEnabled?: boolean;
  complexityMinScore?: number;
}

export interface AgentRunManagerRouteDecision extends AgentRunManagerComplexityDecision {
  useManaged: boolean;
  mode: AgentRunManagerRouteMode;
}

const MULTI_STEP_PATTERNS = [
  /implementation plan/i,
  /verification plan/i,
  /definition of done/i,
  /\bC[0-9]+\b/,
  /继续(完成|实现|开发)/,
  /按照.*计划/,
  /实现.*(后续|阶段|切片)/,
  /完成.*(任务|开发|实现)/,
  /设计.*实现.*验证/,
];

const CODE_CHANGE_PATTERNS = [
  /\bimplement\b/i,
  /\brefactor\b/i,
  /\bmigration\b/i,
  /\bschema\b/i,
  /\bruntime\b/i,
  /\bMCP\b/,
  /\bACP\b/,
  /\bDAG\b/,
  /\bFSM\b/,
  /权限|策略|调度|恢复|迁移|重构|门禁|生命周期/,
];

const VERIFICATION_PATTERNS = [
  /\btests?\b/i,
  /\btypecheck\b/i,
  /\blint\b/i,
  /\bbuild\b/i,
  /\bquality\b/i,
  /测试|验证|回归|门禁/,
];

const DOC_DRIVEN_PATTERNS = [
  /docs\/plans\//,
  /docs\/features\//,
  /AGENTS\.md/,
  /按文档/,
  /计划文档/,
];

function addReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

export function classifyAgentRunManagerTaskComplexity(
  input: AgentRunManagerComplexityInput
): AgentRunManagerComplexityDecision {
  const prompt = input.prompt.trim();
  const reasons: string[] = [];
  let score = 0;

  if (prompt.length >= 1200) {
    score += 2;
    addReason(reasons, "long_prompt");
  } else if (prompt.length >= 500) {
    score += 1;
    addReason(reasons, "medium_prompt");
  }

  if (MULTI_STEP_PATTERNS.some((pattern) => pattern.test(prompt))) {
    score += 3;
    addReason(reasons, "multi_step_plan");
  }
  if (CODE_CHANGE_PATTERNS.some((pattern) => pattern.test(prompt))) {
    score += 2;
    addReason(reasons, "runtime_or_code_change");
  }
  if (VERIFICATION_PATTERNS.some((pattern) => pattern.test(prompt))) {
    score += 1;
    addReason(reasons, "verification_expected");
  }
  if (DOC_DRIVEN_PATTERNS.some((pattern) => pattern.test(prompt))) {
    score += 1;
    addReason(reasons, "doc_driven_context");
  }
  if (input.hasAttachments) {
    score += 1;
    addReason(reasons, "attachments_present");
  }
  if (input.resumeSessionId) {
    score += 1;
    addReason(reasons, "resume_context");
  }

  const level = score >= 6 ? "high" : score >= 4 ? "medium" : "low";
  if (!reasons.length) addReason(reasons, "simple_task");
  return { level, score, reasons };
}

export function resolveAgentRunManagerRoute(input: {
  routing: AgentRunManagerRoutingConfig;
  task: AgentRunManagerComplexityInput;
}): AgentRunManagerRouteDecision {
  const complexity = classifyAgentRunManagerTaskComplexity(input.task);
  if (input.routing.enabled) {
    return { ...complexity, useManaged: true, mode: "force" };
  }
  if (!input.routing.autoEnabled) {
    return { ...complexity, useManaged: false, mode: "off" };
  }
  const minScore = Math.max(0, Math.floor(input.routing.complexityMinScore ?? 4));
  return {
    ...complexity,
    useManaged: complexity.score >= minScore,
    mode: "auto",
  };
}
