import type { SmartRouterDefaultMode } from "../config.js";

export type RouteIntent = "chat" | "task_suggest" | "task_confirm" | "task_auto" | "ignore";

export interface RouteDecision {
  intent: RouteIntent;
  confidence: number;
  reason: string;
  matchedSignals: string[];
  riskFlags: string[];
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
  input: RouteClassifierInput,
  heuristic: RouteDecision
) => Promise<RouteDecision>;

interface SignalDef {
  label: string;
  pattern: RegExp;
  weight: number;
  risk?: string;
}

const TASK_SIGNALS: SignalDef[] = [
  { label: "modify", pattern: /(修复|修一下|改一下|修改|实现|重构|更新|加上|删除|迁移|改成|补上|落地|implement|fix|refactor|update|modify|add|delete|migrate)/i, weight: 3, risk: "writes_files" },
  { label: "docs_or_file", pattern: /(README|readme|docs?|文档|文件|写到|整理到|创建文件|生成.*(web|游戏|页面|文件|报告)|create .*file|write .*docs?)/i, weight: 2, risk: "creates_artifact" },
  { label: "validation", pattern: /(跑测试|测试一下|回归测试|构建|编译|build|lint|typecheck|tsc|e2e|regression test|run tests?)/i, weight: 3, risk: "runs_tests" },
  { label: "execution", pattern: /(触发一次|部署|启动服务|重启|运行|执行|run|start|restart|deploy|trigger)/i, weight: 2, risk: "runs_commands" },
  { label: "git", pattern: /(commit|push|提交|推到|推送|git\s+(commit|push|merge|rebase))/i, weight: 4, risk: "git_operation" },
  { label: "complete_workflow", pattern: /(并(验证|跑|提交|push)|跑完后|完成后|end\s*to\s*end|从.*到.*完成|实现.*验证|fix.*test|update.*commit)/i, weight: 2, risk: "multi_step_work" },
];

const CHAT_SIGNALS: SignalDef[] = [
  { label: "explain", pattern: /(解释|简述|讲讲|是什么|什么意思|基础知识|原理|关系|为什么|why|what is|explain|describe|summari[sz]e)/i, weight: 3 },
  { label: "analysis", pattern: /(分析一下|分析下|对比|风险|是否可行|能否|方案|怎么看|review the idea|compare|analy[sz]e)/i, weight: 2 },
  { label: "knowledge", pattern: /(如何理解|怎么理解|补充背景|概念|设计是什么样|what can|how does|can it)/i, weight: 2 },
];

const AMBIGUOUS_SIGNALS: SignalDef[] = [
  { label: "repo_analysis", pattern: /(分析.*(repo|仓库|项目)|看看.*项目|review.*repo|deep dive)/i, weight: 1 },
  { label: "research", pattern: /(调研|研究一下|找.*方案|research|investigate)/i, weight: 1 },
  { label: "test_word", pattern: /(测试一下|test this|try it)/i, weight: 1 },
];

function collectSignals(content: string, defs: SignalDef[]): { score: number; labels: string[]; risks: string[] } {
  let score = 0;
  const labels: string[] = [];
  const risks: string[] = [];
  for (const def of defs) {
    if (!def.pattern.test(content)) continue;
    score += def.weight;
    labels.push(def.label);
    if (def.risk) risks.push(def.risk);
  }
  return { score, labels: [...new Set(labels)], risks: [...new Set(risks)] };
}

function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, Number(n.toFixed(2))));
}

export function classifyMessageIntent(input: RouteClassifierInput): RouteDecision {
  const content = input.content.trim();
  const hasAttachments = Boolean(input.hasAttachments);
  if (!content && !hasAttachments) {
    return {
      intent: "chat",
      confidence: 0.9,
      reason: "empty message without attachments",
      matchedSignals: [],
      riskFlags: [],
    };
  }

  const task = collectSignals(content, TASK_SIGNALS);
  const chat = collectSignals(content, CHAT_SIGNALS);
  const ambiguous = collectSignals(content, AMBIGUOUS_SIGNALS);
  const matchedSignals = [...new Set([...task.labels, ...chat.labels, ...ambiguous.labels])];
  const riskFlags = [...new Set([...task.risks, ...(hasAttachments ? ["attachments"] : [])])];

  if (!content && hasAttachments) {
    return {
      intent: "chat",
      confidence: 0.65,
      reason: "attachment-only message can be handled by chat unless action is specified",
      matchedSignals: ["attachments"],
      riskFlags,
    };
  }

  const hasHighRiskTask = riskFlags.some((r) => r === "git_operation" || r === "writes_files" || r === "runs_tests");
  if (task.score >= 5 || hasHighRiskTask) {
    return {
      intent: "task_confirm",
      confidence: clampConfidence(0.68 + Math.min(task.score, 7) * 0.04),
      reason: "message contains strong task execution signals",
      matchedSignals,
      riskFlags,
    };
  }

  if (task.score >= 3 && chat.score === 0) {
    return {
      intent: "task_confirm",
      confidence: 0.72,
      reason: "message likely requires execution rather than read-only chat",
      matchedSignals,
      riskFlags,
    };
  }

  if (task.score > 0 && (chat.score > 0 || ambiguous.score > 0)) {
    return {
      intent: "task_suggest",
      confidence: 0.58,
      reason: "message mixes explanation/analysis and executable work signals",
      matchedSignals,
      riskFlags,
    };
  }

  if (ambiguous.score > 0) {
    return {
      intent: "task_suggest",
      confidence: 0.52,
      reason: "message is ambiguous and may benefit from task mode",
      matchedSignals,
      riskFlags,
    };
  }

  if (chat.score > 0 && task.score === 0) {
    return {
      intent: "chat",
      confidence: clampConfidence(0.72 + Math.min(chat.score, 6) * 0.04),
      reason: "message asks for explanation or analysis",
      matchedSignals,
      riskFlags,
    };
  }

  return {
    intent: "chat",
    confidence: 0.6,
    reason: "no strong task signal found",
    matchedSignals,
    riskFlags,
  };
}

export function shouldUseLlmClassifier(decision: RouteDecision, policy: SmartRouterPolicy): boolean {
  if (!policy.enabled || !policy.llmClassifier.enabled) return false;
  if (!policy.llmClassifier.onlyWhenAmbiguous) return true;
  if (decision.intent === "task_suggest") return true;
  if (decision.confidence < policy.minConfirmConfidence) return true;
  return decision.riskFlags.length > 0 && decision.confidence < 0.75;
}

export async function classifySmartRoute(
  input: RouteClassifierInput,
  policy: SmartRouterPolicy,
  llmClassifier?: LlmRouteClassifier
): Promise<RouteDecision> {
  const heuristic = classifyMessageIntent(input);
  if (!shouldUseLlmClassifier(heuristic, policy) || !llmClassifier) return heuristic;

  try {
    const llm = await llmClassifier(input, heuristic);
    return {
      intent: llm.intent,
      confidence: clampConfidence(llm.confidence),
      reason: llm.reason || heuristic.reason,
      matchedSignals: [...new Set([...heuristic.matchedSignals, ...llm.matchedSignals])],
      riskFlags: [...new Set([...heuristic.riskFlags, ...llm.riskFlags])],
    };
  } catch {
    return {
      ...heuristic,
      riskFlags: [...new Set([...heuristic.riskFlags, "classifier_failed"])],
    };
  }
}

export function resolveSmartRouterAction(
  decision: RouteDecision,
  policy: SmartRouterPolicy,
  channelId: string
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

  const confirmAllowed = policy.confirmChannelIds.length === 0 || policy.confirmChannelIds.includes(channelId);
  if (!confirmAllowed) {
    return {
      ...decision,
      intent: "chat",
      reason: `${decision.reason}; channel is not configured for smart-router confirmation`,
    };
  }

  if (decision.intent === "task_confirm" || decision.confidence >= policy.minConfirmConfidence) {
    return { ...decision, intent: "task_confirm" };
  }

  return { ...decision, intent: "task_suggest" };
}
