import { describe, expect, it } from "vitest";
import {
  classifyMessageCapabilities,
  classifyMessageIntent,
  classifySmartRoute,
  resolveSmartRouterAction,
  shouldUseCapabilityClassifier,
  shouldUseLlmClassifier,
  type RouteCapabilityDecision,
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
    estimatedEffort: "short",
    confidence: 0.8,
    reason: "test classifier decision",
    evidence: ["llm_classifier"],
    matchedSignals: ["llm_classifier"],
    riskFlags: [],
    lockedCapabilities: [],
    ...overrides,
  };
}

describe("classifyMessageCapabilities and fallback route", () => {
  it("keeps explanation as chat without task capabilities", () => {
    const d = classifyMessageIntent({ content: "解释一下 RSS 是什么", channelId: "chat-1" });
    expect(d.intent).toBe("chat");
    expect(d.matchedSignals).toContain("explain");
    expect(d.capabilities?.needsMultiStepResearch).toBe(false);
  });

  it("keeps plain Chinese summaries as chat", () => {
    const d = classifyMessageIntent({ content: "总结一下这篇文章", channelId: "chat-1" });
    expect(d.intent).toBe("chat");
    expect(d.matchedSignals).toContain("summary");
  });

  it("keeps ordinary URL summaries in chat but asks the capability classifier to verify", () => {
    const d = classifyMessageIntent({ content: "https://example.com/post 给我总结一下", channelId: "chat-1" });
    expect(d.intent).toBe("chat");
    expect(d.matchedSignals).toContain("summary");
    expect(d.matchedSignals).toContain("external_url");
    expect(d.capabilities?.hasExternalUrl).toBe(true);
    expect(shouldUseLlmClassifier(d, policy)).toBe(true);
  });

  it("suggests task mode for WeChat public-account article summaries without classifier downgrade", () => {
    const d = classifyMessageIntent({
      content: "链接：https://mp.weixin.qq.com/s/43wPVMKzNxC_R0ZYmUn0Rg 给我总结一下",
      channelId: "chat-1",
    });
    expect(d.intent).toBe("task_suggest");
    expect(d.matchedSignals).toContain("wechat_article");
    expect(d.capabilities?.needsBrowser).toBe(true);
    expect(d.riskFlags).toContain("browser_required");
    expect(shouldUseCapabilityClassifier(d.capabilities!, policy)).toBe(false);

    const resolved = resolveSmartRouterAction(d, policy, "chat-1");
    expect(resolved.intent).toBe("task_suggest");
  });

  it("suggests task mode for URL-only messages so the classifier can decide", () => {
    const d = classifyMessageIntent({ content: "https://example.com/post", channelId: "chat-1" });
    expect(d.intent).toBe("task_suggest");
    expect(d.matchedSignals).toContain("external_url");
    expect(shouldUseLlmClassifier(d, policy)).toBe(true);
  });

  it("classifies file modification plus validation as task_confirm", () => {
    const d = classifyMessageIntent({ content: "修改 README 并跑测试", channelId: "chat-1" });
    expect(d.intent).toBe("task_confirm");
    expect(d.capabilities?.needsFileWrite).toBe(true);
    expect(d.capabilities?.needsShell).toBe(true);
    expect(d.riskFlags).toContain("writes_files");
    expect(d.riskFlags).toContain("runs_tests");
  });

  it("classifies git operations as task_confirm", () => {
    const d = classifyMessageIntent({ content: "commit 并 push 到 GitHub main", channelId: "chat-1" });
    expect(d.intent).toBe("task_confirm");
    expect(d.capabilities?.needsGit).toBe(true);
    expect(d.riskFlags).toContain("git_operation");
  });

  it("classifies explicit capture or persistent output requests as task_confirm", () => {
    const d = classifyMessageIntent({
      content: "抓取这个公众号链接，整理成 Obsidian 笔记",
      channelId: "chat-1",
    });
    expect(d.intent).toBe("task_confirm");
    expect(d.capabilities?.createsPersistentOutput).toBe(true);
    expect(d.capabilities?.needsLongRunning).toBe(true);
    expect(d.riskFlags).toContain("long_running_or_persistent_output");
  });

  it("keeps attachment-only messages in chat by default", () => {
    const d = classifyMessageIntent({ content: "", channelId: "chat-1", hasAttachments: true });
    expect(d.intent).toBe("chat");
    expect(d.capabilities?.hasAttachments).toBe(true);
    expect(d.matchedSignals).toContain("attachments");
  });

  it("classifies repo analysis as multi-step research task_suggest", () => {
    const d = classifyMessageIntent({ content: "帮我深入分析这个 repo", channelId: "chat-1" });
    expect(d.intent).toBe("task_suggest");
    expect(d.capabilities?.needsMultiStepResearch).toBe(true);
  });

  it("classifies runtime failure diagnosis as task_confirm", () => {
    const d = classifyMessageIntent({ content: "为什么会任务失败呢? 给我分析一下", channelId: "other" });
    expect(d.intent).toBe("task_confirm");
    expect(d.capabilities?.needsRuntimeInspection).toBe(true);
    expect(d.matchedSignals).toContain("runtime_diagnostics");
    expect(d.riskFlags).toContain("runtime_diagnostics");
  });

  it("suggests task mode for current GitHub contribution investigations", () => {
    const d = classifyMessageIntent({
      content: "steipete 他做了什么事情？为什么今天有那么多的 contribution？你帮我分析一下",
      channelId: "chat-1",
    });
    expect(d.intent).toBe("task_suggest");
    expect(d.matchedSignals).toContain("external_activity_research");
    expect(d.capabilities?.needsCurrentInfo).toBe(true);
    expect(d.capabilities?.needsMultiStepResearch).toBe(true);
    expect(shouldUseCapabilityClassifier(d.capabilities!, policy)).toBe(true);

    const resolved = resolveSmartRouterAction(d, policy, "chat-1");
    expect(resolved.intent).toBe("task_suggest");
  });

  it("keeps basic GitHub concept questions in chat", () => {
    const d = classifyMessageIntent({ content: "GitHub contribution 是什么意思？", channelId: "chat-1" });
    expect(d.intent).toBe("chat");
    expect(d.matchedSignals).not.toContain("external_activity_research");
    expect(d.capabilities?.needsCurrentInfo).toBe(false);
  });
});

describe("capability classifier decision points", () => {
  it("uses the classifier for ambiguous suggestions", () => {
    const d = classifyMessageCapabilities({ content: "调研一下有没有方案", channelId: "chat-1" });
    expect(shouldUseCapabilityClassifier(d, policy)).toBe(true);
  });

  it("allows the classifier to downgrade soft research hints to chat", async () => {
    const d = await classifySmartRoute(
      { content: "调研一下有没有方案", channelId: "chat-1" },
      policy,
      async () => capability({
        reason: "can be answered as a short read-only brainstorm",
        evidence: ["short_brainstorm"],
        matchedSignals: ["short_brainstorm"],
      })
    );
    expect(d.intent).toBe("chat");
    expect(d.matchedSignals).toContain("research");
    expect(d.matchedSignals).toContain("llm_classifier");
    expect(d.capabilities?.needsMultiStepResearch).toBe(false);
  });

  it("does not let the classifier downgrade locked write and shell capabilities", async () => {
    const d = await classifySmartRoute(
      { content: "修改 README 并跑测试", channelId: "chat-1" },
      policy,
      async () => capability({ reason: "should not be used" })
    );
    expect(d.intent).toBe("task_confirm");
    expect(d.matchedSignals).not.toContain("llm_classifier");
    expect(d.capabilities?.needsFileWrite).toBe(true);
    expect(d.capabilities?.needsShell).toBe(true);
  });

  it("keeps deterministic browser-required URL summaries as task_suggest without classifier override", async () => {
    const d = await classifySmartRoute(
      { content: "链接：https://mp.weixin.qq.com/s/43wPVMKzNxC_R0ZYmUn0Rg 给我总结一下", channelId: "chat-1" },
      policy,
      async () => capability({ reason: "should not be used" })
    );
    expect(d.intent).toBe("task_suggest");
    expect(d.matchedSignals).not.toContain("llm_classifier");
    expect(d.capabilities?.needsBrowser).toBe(true);
  });

  it("lets the classifier upgrade ordinary URL summaries when current multi-step research is needed", async () => {
    const d = await classifySmartRoute(
      { content: "https://example.com/releases 给我分析最近变化", channelId: "chat-1" },
      policy,
      async () => capability({
        needsCurrentInfo: true,
        needsMultiStepResearch: true,
        hasExternalUrl: true,
        estimatedEffort: "medium",
        reason: "requires current release investigation",
        evidence: ["current_releases"],
      })
    );
    expect(d.intent).toBe("task_suggest");
    expect(d.capabilities?.needsCurrentInfo).toBe(true);
    expect(d.capabilities?.needsMultiStepResearch).toBe(true);
  });

  it("fails closed to heuristic capabilities when the classifier throws", async () => {
    const d = await classifySmartRoute(
      { content: "调研一下有没有方案", channelId: "chat-1" },
      policy,
      async () => {
        throw new Error("classifier unavailable");
      }
    );
    expect(d.intent).toBe("task_suggest");
    expect(d.riskFlags).toContain("classifier_failed");
    expect(d.capabilities?.needsMultiStepResearch).toBe(true);
  });
});

describe("resolveSmartRouterAction", () => {
  it("auto-routes only trusted auto task channels", () => {
    const decision = classifyMessageIntent({ content: "修改 README 并跑测试", channelId: "task-auto" });
    const resolved = resolveSmartRouterAction(decision, policy, "task-auto");
    expect(resolved.intent).toBe("task_auto");
  });

  it("requires configured confirmation channel", () => {
    const decision = classifyMessageIntent({ content: "修改 README 并跑测试", channelId: "other" });
    const resolved = resolveSmartRouterAction(decision, policy, "other");
    expect(resolved.intent).toBe("chat");
  });

  it("allows confirmation outside configured channels for explicit mentions", () => {
    const decision = classifyMessageIntent({ content: "为什么会任务失败呢? 给我分析一下", channelId: "other" });
    const resolved = resolveSmartRouterAction(decision, policy, "other", { wasMentioned: true });
    expect(resolved.intent).toBe("task_confirm");
  });

  it("preserves confirmation in configured channel", () => {
    const decision = classifyMessageIntent({ content: "修改 README 并跑测试", channelId: "chat-1" });
    const resolved = resolveSmartRouterAction(decision, policy, "chat-1");
    expect(resolved.intent).toBe("task_confirm");
  });
});
