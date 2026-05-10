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
  estimatedEffort: EstimatedEffort;
  confidence: number;
  reason: string;
  evidence: string[];
  matchedSignals: string[];
  riskFlags: string[];
  lockedCapabilities: RouteCapabilityName[];
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
  heuristic: RouteCapabilityDecision
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

interface SignalDef {
  label: string;
  pattern: RegExp;
  weight: number;
  risk?: string;
  capabilities?: readonly RouteCapabilityName[];
  lockedCapabilities?: readonly RouteCapabilityName[];
  effort?: EstimatedEffort;
}

interface CollectedSignals {
  score: number;
  labels: string[];
  risks: string[];
  capabilities: RouteCapabilityName[];
  lockedCapabilities: RouteCapabilityName[];
  effort: EstimatedEffort;
}

const TASK_SIGNALS: SignalDef[] = [
  {
    label: "runtime_diagnostics",
    pattern: /(任务失败|失败原因|回复出错|报错|出错|异常|排查|定位.*问题|看看.*问题|看一下.*问题|为什么.*失败|debug|diagnos(?:e|is)|troubleshoot|failed task|why.*fail)/i,
    weight: 5,
    risk: "runtime_diagnostics",
    capabilities: ["needsRuntimeInspection", "needsShell"],
    lockedCapabilities: ["needsRuntimeInspection"],
    effort: "medium",
  },
  {
    label: "modify",
    pattern: /(修复|修一下|改一下|修改|实现|重构|更新|加上|删除|迁移|改成|补上|落地|implement|fix|refactor|update|modify|add|delete|migrate)/i,
    weight: 3,
    risk: "writes_files",
    capabilities: ["needsFileWrite"],
    lockedCapabilities: ["needsFileWrite"],
    effort: "medium",
  },
  {
    label: "docs_or_file",
    pattern: /(README|readme|docs?|文档|文件|写到|整理到|创建文件|生成.*(web|游戏|页面|文件|报告)|create .*file|write .*docs?)/i,
    weight: 2,
    risk: "creates_artifact",
    capabilities: ["createsPersistentOutput"],
    lockedCapabilities: ["createsPersistentOutput"],
    effort: "medium",
  },
  {
    label: "capture_or_persist",
    pattern: /(抓取|爬取|采集|持续监控|监控.*(更新|发布|文章)|输出到|写入|落盘|导出|保存(成|到)?.*(文件|docs?|文档|报告|笔记|Obsidian|obsidian|markdown|md)|整理(成|到).*(文件|docs?|文档|报告|笔记|Obsidian|obsidian|markdown|md)|保存笔记|整理成笔记)/i,
    weight: 5,
    risk: "long_running_or_persistent_output",
    capabilities: ["needsLongRunning", "createsPersistentOutput"],
    lockedCapabilities: ["createsPersistentOutput"],
    effort: "long",
  },
  {
    label: "validation",
    pattern: /(跑测试|测试一下|回归测试|构建|编译|build|lint|typecheck|tsc|e2e|regression test|run tests?)/i,
    weight: 3,
    risk: "runs_tests",
    capabilities: ["needsShell", "needsLongRunning"],
    lockedCapabilities: ["needsShell"],
    effort: "medium",
  },
  {
    label: "execution",
    pattern: /(触发一次|部署|启动服务|重启|运行|执行|run|start|restart|deploy|trigger)/i,
    weight: 2,
    risk: "runs_commands",
    capabilities: ["needsShell"],
    lockedCapabilities: ["needsShell"],
    effort: "medium",
  },
  {
    label: "git",
    pattern: /(commit|push|提交|推到|推送|git\s+(commit|push|merge|rebase))/i,
    weight: 4,
    risk: "git_operation",
    capabilities: ["needsGit", "needsShell"],
    lockedCapabilities: ["needsGit", "needsShell"],
    effort: "medium",
  },
  {
    label: "complete_workflow",
    pattern: /(并(验证|跑|提交|push)|跑完后|完成后|end\s*to\s*end|从.*到.*完成|实现.*验证|fix.*test|update.*commit)/i,
    weight: 2,
    risk: "multi_step_work",
    capabilities: ["needsLongRunning"],
    effort: "long",
  },
];

const CHAT_SIGNALS: SignalDef[] = [
  { label: "explain", pattern: /(解释|简述|讲讲|是什么|什么意思|基础知识|原理|关系|为什么|why|what is|explain|describe)/i, weight: 3 },
  { label: "summary", pattern: /(总结|概括|摘要|归纳|提炼|tldr|tl;dr|summari[sz]e)/i, weight: 3 },
  { label: "analysis", pattern: /(分析一下|分析下|对比|风险|是否可行|能否|方案|怎么看|review the idea|compare|analy[sz]e)/i, weight: 2 },
  { label: "knowledge", pattern: /(如何理解|怎么理解|补充背景|概念|设计是什么样|what can|how does|can it)/i, weight: 2 },
];

const EXTERNAL_ACTIVITY_RESEARCH_PATTERN =
  /((github|contributions?|commits?|pull requests?|prs?|issues?|releases?|repos?|repositories?|仓库|开发动态|开源动态).*(今天|今日|昨天|最近|这两天|过去|这周|本周|latest|recent|today|yesterday|this\s+week|last\s+\d+|做了什么|发生了什么|为什么|分析一下|分析下|查一下|看一下|看看)|(?:今天|今日|昨天|最近|这两天|过去|这周|本周|latest|recent|today|yesterday|this\s+week|last\s+\d+).*(github|contributions?|commits?|pull requests?|prs?|issues?|releases?|repos?|repositories?|仓库|开发动态|开源动态))/i;

const AMBIGUOUS_SIGNALS: SignalDef[] = [
  {
    label: "repo_analysis",
    pattern: /(分析.*(repo|仓库|项目)|看看.*项目|review.*repo|deep dive)/i,
    weight: 1,
    capabilities: ["needsMultiStepResearch"],
    effort: "medium",
  },
  {
    label: "external_activity_research",
    pattern: EXTERNAL_ACTIVITY_RESEARCH_PATTERN,
    weight: 2,
    risk: "long_running_research",
    capabilities: ["needsCurrentInfo", "needsMultiStepResearch", "needsLongRunning"],
    effort: "medium",
  },
  {
    label: "research",
    pattern: /(调研|研究一下|找.*方案|research|investigate)/i,
    weight: 1,
    capabilities: ["needsMultiStepResearch"],
    effort: "medium",
  },
  {
    label: "test_word",
    pattern: /(测试一下|test this|try it)/i,
    weight: 1,
    capabilities: ["needsShell"],
    effort: "medium",
  },
];

const URL_PATTERN = /https?:\/\/[^\s<>"'`，。！？、)）]+/i;
const WECHAT_ARTICLE_PATTERN = /https?:\/\/mp\.weixin\.qq\.com\/[^\s<>"'`，。！？、)）]+|微信公众号|公众号文章/i;
const BROWSER_REQUIRED_PATTERN = /(浏览器|登录态|动态加载|反爬|验证码|cookie|cookies|opencli|browser)/i;

function urlContext(content: string): { hasUrl: boolean; isWechatArticle: boolean; needsBrowser: boolean } {
  const hasUrl = URL_PATTERN.test(content);
  const isWechatArticle = WECHAT_ARTICLE_PATTERN.test(content);
  return {
    hasUrl,
    isWechatArticle,
    needsBrowser: isWechatArticle || BROWSER_REQUIRED_PATTERN.test(content),
  };
}

function effortRank(effort: EstimatedEffort): number {
  if (effort === "long") return 3;
  if (effort === "medium") return 2;
  return 1;
}

function maxEffort(a: EstimatedEffort, b: EstimatedEffort): EstimatedEffort {
  return effortRank(a) >= effortRank(b) ? a : b;
}

function collectSignals(content: string, defs: readonly SignalDef[]): CollectedSignals {
  let score = 0;
  let effort: EstimatedEffort = "short";
  const labels = new Set<string>();
  const risks = new Set<string>();
  const capabilities = new Set<RouteCapabilityName>();
  const lockedCapabilities = new Set<RouteCapabilityName>();

  for (const def of defs) {
    if (!def.pattern.test(content)) continue;
    score += def.weight;
    labels.add(def.label);
    if (def.risk) risks.add(def.risk);
    for (const capability of def.capabilities ?? []) capabilities.add(capability);
    for (const capability of def.lockedCapabilities ?? []) lockedCapabilities.add(capability);
    if (def.effort) effort = maxEffort(effort, def.effort);
  }

  return {
    score,
    labels: [...labels],
    risks: [...risks],
    capabilities: [...capabilities],
    lockedCapabilities: [...lockedCapabilities],
    effort,
  };
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
    estimatedEffort: "short",
    confidence: 0.5,
    reason: "no capability signal found",
    evidence: [],
    matchedSignals: [],
    riskFlags: [],
    lockedCapabilities: [],
    ...overrides,
  };
}

function applyCapabilities(
  decision: RouteCapabilityDecision,
  capabilities: readonly RouteCapabilityName[],
  lockedCapabilities: readonly RouteCapabilityName[] = []
): void {
  for (const capability of capabilities) decision[capability] = true;
  decision.lockedCapabilities = [...new Set([...decision.lockedCapabilities, ...lockedCapabilities])];
}

function highRiskCapabilities(decision: RouteCapabilityDecision): RouteCapabilityName[] {
  return CAPABILITY_NAMES.filter((name) => {
    if (name === "needsCurrentInfo" || name === "needsMultiStepResearch" || name === "needsBrowser" || name === "needsLongRunning") {
      return false;
    }
    return decision[name];
  });
}

function researchCapabilities(decision: RouteCapabilityDecision): RouteCapabilityName[] {
  return CAPABILITY_NAMES.filter((name) => {
    if (name === "needsCurrentInfo" || name === "needsMultiStepResearch" || name === "needsBrowser" || name === "needsLongRunning") {
      return decision[name];
    }
    return false;
  });
}

function hasChatSignal(decision: RouteCapabilityDecision): boolean {
  return decision.matchedSignals.some((signal) => signal === "explain" || signal === "summary" || signal === "analysis" || signal === "knowledge");
}

function channelListMatches(channelIds: readonly string[], channelId: string): boolean {
  return channelIds.length === 0 || channelIds.includes("*") || channelIds.includes(channelId);
}

function buildReason(decision: RouteCapabilityDecision): string {
  const highRisk = highRiskCapabilities(decision);
  if (highRisk.length) return `message requires task-only capabilities: ${highRisk.join(", ")}`;
  if (decision.needsBrowser) return "message likely needs browser or dynamic-page handling";
  if (decision.needsCurrentInfo && decision.needsMultiStepResearch) return "message likely needs current multi-step research";
  if (decision.needsLongRunning) return "message may exceed lightweight chat limits";
  if (decision.needsMultiStepResearch) return "message may need multi-step research";
  if (decision.hasExternalUrl && !hasChatSignal(decision)) return "message contains a URL but no clear lightweight chat intent";
  if (hasChatSignal(decision)) return "message asks for read-only explanation, summary, or analysis";
  return decision.reason || "no strong task capability found";
}

export function classifyMessageCapabilities(input: RouteClassifierInput): RouteCapabilityDecision {
  const content = input.content.trim();
  const hasAttachments = Boolean(input.hasAttachments);

  if (!content && !hasAttachments) {
    return emptyCapabilities({
      confidence: 0.9,
      reason: "empty message without attachments",
      evidence: ["empty_message"],
    });
  }

  const task = collectSignals(content, TASK_SIGNALS);
  const chat = collectSignals(content, CHAT_SIGNALS);
  const ambiguous = collectSignals(content, AMBIGUOUS_SIGNALS);
  const url = urlContext(content);
  const matchedSignals = [
    ...new Set([
      ...task.labels,
      ...chat.labels,
      ...ambiguous.labels,
      ...(url.hasUrl ? ["external_url"] : []),
      ...(url.isWechatArticle ? ["wechat_article"] : []),
      ...(url.needsBrowser ? ["browser_required"] : []),
      ...(hasAttachments ? ["attachments"] : []),
    ]),
  ];
  const riskFlags = [
    ...new Set([
      ...task.risks,
      ...ambiguous.risks,
      ...(hasAttachments ? ["attachments"] : []),
      ...(url.hasUrl ? ["external_url"] : []),
      ...(url.needsBrowser ? ["browser_required"] : []),
    ]),
  ];

  const decision = emptyCapabilities({
    hasExternalUrl: url.hasUrl,
    hasAttachments,
    estimatedEffort: maxEffort(task.effort, ambiguous.effort),
    evidence: matchedSignals,
    matchedSignals,
    riskFlags,
  });

  applyCapabilities(decision, task.capabilities, task.lockedCapabilities);
  applyCapabilities(decision, ambiguous.capabilities, ambiguous.lockedCapabilities);

  if (url.needsBrowser) {
    decision.needsBrowser = true;
    decision.lockedCapabilities = [...new Set<RouteCapabilityName>([...decision.lockedCapabilities, "needsBrowser"])];
    decision.estimatedEffort = maxEffort(decision.estimatedEffort, "medium");
  }

  if (!content && hasAttachments) {
    decision.confidence = 0.65;
    decision.reason = "attachment-only message can be handled by chat unless action is specified";
    return decision;
  }

  if (task.labels.includes("runtime_diagnostics")) {
    decision.confidence = 0.82;
  } else if (highRiskCapabilities(decision).length || task.score >= 5) {
    decision.confidence = clampConfidence(0.68 + Math.min(task.score, 7) * 0.04);
  } else if (decision.needsBrowser) {
    decision.confidence = 0.7;
  } else if (researchCapabilities(decision).length) {
    decision.confidence = 0.58;
  } else if (chat.score > 0 && task.score === 0 && ambiguous.score === 0) {
    decision.confidence = clampConfidence(0.72 + Math.min(chat.score, 6) * 0.04);
  } else {
    decision.confidence = 0.55;
  }

  decision.reason = buildReason(decision);
  return decision;
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
    capabilities.needsBrowser ||
    (capabilities.needsCurrentInfo && capabilities.needsMultiStepResearch) ||
    capabilities.needsLongRunning ||
    capabilities.needsMultiStepResearch ||
    (capabilities.hasExternalUrl && !hasChatSignal(capabilities))
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
  if (!policy.llmClassifier.onlyWhenAmbiguous) return true;
  if (!decision.matchedSignals.length && !decision.hasAttachments) return false;
  if (highRiskCapabilities(decision).length && decision.confidence >= 0.75) return false;
  if (decision.needsBrowser && decision.lockedCapabilities.includes("needsBrowser")) return false;
  if (decision.hasExternalUrl || decision.needsCurrentInfo || decision.needsMultiStepResearch || decision.needsLongRunning) return true;
  if (decision.confidence < policy.minConfirmConfidence) return true;
  return decision.riskFlags.length > 0 && decision.confidence < 0.75;
}

export function shouldUseLlmClassifier(decision: RouteDecision, policy: SmartRouterPolicy): boolean {
  if (decision.capabilities) return shouldUseCapabilityClassifier(decision.capabilities, policy);
  if (!policy.enabled || !policy.llmClassifier.enabled) return false;
  if (!policy.llmClassifier.onlyWhenAmbiguous) return true;
  if (decision.intent === "task_suggest") return true;
  if (decision.confidence < policy.minConfirmConfidence) return true;
  return decision.riskFlags.length > 0 && decision.confidence < 0.75;
}

export function mergeCapabilityDecisions(
  heuristic: RouteCapabilityDecision,
  llm: RouteCapabilityDecision
): RouteCapabilityDecision {
  const locked = new Set(heuristic.lockedCapabilities);
  const merged = emptyCapabilities({
    ...llm,
    confidence: clampConfidence(llm.confidence),
    evidence: [...new Set([...heuristic.evidence, ...llm.evidence, "llm_classifier"])],
    matchedSignals: [...new Set([...heuristic.matchedSignals, ...llm.matchedSignals, "llm_classifier"])],
    riskFlags: [...new Set([...heuristic.riskFlags, ...llm.riskFlags])],
    lockedCapabilities: [...locked],
    hasExternalUrl: heuristic.hasExternalUrl || llm.hasExternalUrl,
    hasAttachments: heuristic.hasAttachments || llm.hasAttachments,
    estimatedEffort: maxEffort(heuristic.estimatedEffort, llm.estimatedEffort),
    reason: llm.reason || heuristic.reason,
  });

  for (const capability of CAPABILITY_NAMES) {
    merged[capability] = locked.has(capability) ? true : Boolean(llm[capability]);
  }

  return merged;
}

export async function classifySmartRoute(
  input: RouteClassifierInput,
  policy: SmartRouterPolicy,
  llmClassifier?: LlmRouteClassifier
): Promise<RouteDecision> {
  const heuristic = classifyMessageCapabilities(input);
  let capabilities = heuristic;

  if (shouldUseCapabilityClassifier(heuristic, policy) && llmClassifier) {
    try {
      const llm = await llmClassifier(input, heuristic);
      capabilities = mergeCapabilityDecisions(heuristic, llm);
    } catch {
      capabilities = {
        ...heuristic,
        riskFlags: [...new Set([...heuristic.riskFlags, "classifier_failed"])],
      };
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
