import { describe, expect, it } from "vitest";
import {
  classifyMessageCapabilities,
  classifyMessageIntent,
  classifySmartRoute,
  resolveCapabilitiesToRouteDecision,
  resolveSmartRouterAction,
  shouldUseCapabilityClassifier,
  shouldUseLlmClassifier,
  type RouteCapabilityDecision,
  type RouteDecision,
  type SmartRouterPolicy,
} from "../intent.js";

const policy: SmartRouterPolicy = {
  enabled: true,
  defaultMode: "confirm",
  minConfirmConfidence: 0.55,
  minAutoConfidence: 0.9,
  confirmChannelIds: ["chat-1"],
  autoTaskChannelIds: ["task-auto"],
  llmClassifier: {
    enabled: true,
    onlyWhenAmbiguous: true,
  },
};

function capability(overrides: Partial<RouteCapabilityDecision> = {}): RouteCapabilityDecision {
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
    confidence: 0.82,
    reason: "test classifier decision",
    evidence: ["llm_classifier"],
    matchedSignals: ["llm_classifier"],
    riskFlags: [],
    ...overrides,
  };
}

function decisionFromCapabilities(overrides: Partial<RouteCapabilityDecision> = {}): RouteDecision {
  return resolveCapabilitiesToRouteDecision(capability(overrides));
}

describe("objective fallback capabilities", () => {
  it("does not classify semantic task intent without the LLM classifier", () => {
    const d = classifyMessageIntent({
      content: "stock-pulse中的当前持仓盘中快照 盈利组/亏损组要加个总的日内盈亏",
      channelId: "chat-1",
    });

    expect(d.intent).toBe("chat");
    expect(d.capabilities?.needsFileWrite).toBe(false);
    expect(d.matchedSignals).toEqual([]);
  });

  it("keeps ordinary read-only explanations as chat in fallback mode", () => {
    const d = classifyMessageIntent({ content: "GitHub contribution 是什么意思？", channelId: "chat-1" });
    expect(d.intent).toBe("chat");
    expect(d.capabilities?.needsCurrentInfo).toBe(false);
    expect(d.capabilities?.needsMultiStepResearch).toBe(false);
  });

  it("suggests task mode for URL-only messages because intent is underspecified", () => {
    const d = classifyMessageIntent({ content: "链接：https://example.com/post", channelId: "chat-1" });
    expect(d.intent).toBe("task_suggest");
    expect(d.matchedSignals).toEqual(["external_url", "url_only"]);
    expect(d.capabilities?.isUrlOnly).toBe(true);
  });

  it("does not force ordinary URL summaries into task without LLM capabilities", () => {
    const d = classifyMessageIntent({ content: "https://example.com/post 给我总结一下", channelId: "chat-1" });
    expect(d.intent).toBe("chat");
    expect(d.matchedSignals).toEqual(["external_url"]);
    expect(d.capabilities?.hasExternalUrl).toBe(true);
    expect(d.capabilities?.isUrlOnly).toBe(false);
  });

  it("keeps attachment-only messages in chat by default", () => {
    const d = classifyMessageIntent({ content: "", channelId: "chat-1", hasAttachments: true });
    expect(d.intent).toBe("chat");
    expect(d.capabilities?.hasAttachments).toBe(true);
    expect(d.matchedSignals).toEqual(["attachments"]);
  });
});

describe("LLM-first classifier decision points", () => {
  it("uses the classifier for plain text even when there are no objective signals", () => {
    const d = classifyMessageCapabilities({ content: "解释一下 RSS 是什么", channelId: "chat-1" });
    expect(d.matchedSignals).toEqual([]);
    expect(shouldUseCapabilityClassifier(d, policy)).toBe(true);
    expect(shouldUseLlmClassifier(resolveCapabilitiesToRouteDecision(d), policy)).toBe(true);
  });

  it("does not call the classifier for an empty message without attachments", () => {
    const d = classifyMessageCapabilities({ content: "", channelId: "chat-1" });
    expect(shouldUseCapabilityClassifier(d, policy)).toBe(false);
  });

  it("respects the top-level classifier enabled flag", () => {
    const d = classifyMessageCapabilities({ content: "修改 README", channelId: "chat-1" });
    expect(shouldUseCapabilityClassifier(d, {
      ...policy,
      llmClassifier: { ...policy.llmClassifier, enabled: false },
    })).toBe(false);
  });

  it("allows the classifier to keep a simple explanation in chat", async () => {
    let called = false;
    const d = await classifySmartRoute(
      { content: "解释一下 RSS 是什么", channelId: "chat-1" },
      policy,
      async (input) => {
        called = true;
        expect(input.content).toContain("RSS");
        return capability({
          reason: "read-only concept explanation",
          evidence: ["concept_explanation"],
          matchedSignals: ["concept_explanation"],
        });
      }
    );

    expect(called).toBe(true);
    expect(d.intent).toBe("chat");
    expect(d.matchedSignals).toContain("llm_classifier");
    expect(d.capabilities?.needsMultiStepResearch).toBe(false);
  });

  it("suggests task mode for the steipete contribution-spike prompt", async () => {
    const d = await classifySmartRoute(
      { content: "steipete的1099 次贡献他是如何做到的？你能给我简单拆解一下吗？", channelId: "chat-1" },
      policy,
      async () => capability({
        needsCurrentInfo: true,
        needsMultiStepResearch: true,
        estimatedEffort: "medium",
        reason: "requires current GitHub activity investigation",
        evidence: ["current_contribution_activity"],
        riskFlags: ["current_info"],
      })
    );

    expect(d.intent).toBe("task_suggest");
    expect(d.capabilities?.needsCurrentInfo).toBe(true);
    expect(d.capabilities?.needsMultiStepResearch).toBe(true);

    const resolved = resolveSmartRouterAction(d, policy, "chat-1");
    expect(resolved.intent).toBe("task_suggest");
  });

  it("confirms task mode for the stock-pulse intraday snapshot change request", async () => {
    const d = await classifySmartRoute(
      {
        content: "stock-pulse中的当前持仓盘中快照 盈利组/亏损组要在旁边加个总的日内盈亏的数值 盈利组/亏损组中要按照日内盈亏来排序",
        channelId: "chat-1",
      },
      policy,
      async () => capability({
        needsFileWrite: true,
        estimatedEffort: "medium",
        reason: "project UI/data display change requires code edits",
        evidence: ["project_change_request", "intraday_pnl_sorting"],
        riskFlags: ["writes_files"],
      })
    );

    expect(d.intent).toBe("task_confirm");
    expect(d.capabilities?.needsFileWrite).toBe(true);
    expect(d.riskFlags).toContain("writes_files");

    const resolved = resolveSmartRouterAction(d, policy, "chat-1");
    expect(resolved.intent).toBe("task_confirm");
  });

  it("confirms task mode for shell, runtime, and git capabilities", async () => {
    const d = await classifySmartRoute(
      { content: "为什么会任务失败？帮我查日志并修一下", channelId: "chat-1" },
      policy,
      async () => capability({
        needsRuntimeInspection: true,
        needsShell: true,
        needsFileWrite: true,
        needsGit: true,
        estimatedEffort: "long",
        reason: "requires local runtime inspection and code repair",
        evidence: ["runtime_diagnostics", "code_repair"],
        riskFlags: ["runtime_inspection", "runs_commands", "writes_files", "git_operation"],
      })
    );

    expect(d.intent).toBe("task_confirm");
    expect(d.capabilities?.needsRuntimeInspection).toBe(true);
    expect(d.capabilities?.needsShell).toBe(true);
    expect(d.capabilities?.needsGit).toBe(true);
  });

  it("suggests task mode for browser-dependent summaries when the classifier says browser is needed", async () => {
    const d = await classifySmartRoute(
      { content: "链接：https://mp.weixin.qq.com/s/43wPVMKzNxC_R0ZYmUn0Rg 给我总结一下", channelId: "chat-1" },
      policy,
      async () => capability({
        needsBrowser: true,
        hasExternalUrl: true,
        estimatedEffort: "medium",
        reason: "WeChat article likely requires browser handling",
        evidence: ["dynamic_page"],
        riskFlags: ["browser_required"],
      })
    );

    expect(d.intent).toBe("task_suggest");
    expect(d.capabilities?.needsBrowser).toBe(true);
    expect(d.matchedSignals).toContain("external_url");
    expect(d.matchedSignals).toContain("llm_classifier");
  });

  it("falls back to objective facts when the classifier throws", async () => {
    const d = await classifySmartRoute(
      { content: "调研一下有没有方案", channelId: "chat-1" },
      policy,
      async () => {
        throw new Error("classifier unavailable");
      }
    );

    expect(d.intent).toBe("chat");
    expect(d.riskFlags).toContain("classifier_failed");
    expect(d.capabilities?.needsMultiStepResearch).toBe(false);
  });
});

describe("resolveSmartRouterAction", () => {
  it("auto-routes only trusted auto task channels", () => {
    const decision = decisionFromCapabilities({
      needsFileWrite: true,
      confidence: 0.95,
      reason: "file edit",
      riskFlags: ["writes_files"],
    });
    const resolved = resolveSmartRouterAction(decision, policy, "task-auto");
    expect(resolved.intent).toBe("task_auto");
  });

  it("requires configured confirmation channel", () => {
    const decision = decisionFromCapabilities({
      needsFileWrite: true,
      reason: "file edit",
      riskFlags: ["writes_files"],
    });
    const resolved = resolveSmartRouterAction(decision, policy, "other");
    expect(resolved.intent).toBe("chat");
  });

  it("allows confirmation in any eligible channel when confirm channels are empty", () => {
    const decision = decisionFromCapabilities({ needsFileWrite: true });
    const resolved = resolveSmartRouterAction(
      decision,
      { ...policy, confirmChannelIds: [] },
      "other"
    );
    expect(resolved.intent).toBe("task_confirm");
  });

  it("allows confirmation in any eligible channel when confirm channels contain wildcard", () => {
    const decision = decisionFromCapabilities({ needsFileWrite: true });
    const resolved = resolveSmartRouterAction(
      decision,
      { ...policy, confirmChannelIds: ["*"] },
      "other"
    );
    expect(resolved.intent).toBe("task_confirm");
  });

  it("allows confirmation outside configured channels for explicit mentions", () => {
    const decision = decisionFromCapabilities({ needsRuntimeInspection: true });
    const resolved = resolveSmartRouterAction(decision, policy, "other", { wasMentioned: true });
    expect(resolved.intent).toBe("task_confirm");
  });

  it("preserves confirmation in configured channel", () => {
    const decision = decisionFromCapabilities({ needsFileWrite: true });
    const resolved = resolveSmartRouterAction(decision, policy, "chat-1");
    expect(resolved.intent).toBe("task_confirm");
  });
});
