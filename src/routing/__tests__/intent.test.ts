import { describe, expect, it } from "vitest";
import {
  classifyMessageIntent,
  classifySmartRoute,
  resolveSmartRouterAction,
  shouldUseLlmClassifier,
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

describe("classifyMessageIntent", () => {
  it("classifies explanation as chat", () => {
    const d = classifyMessageIntent({ content: "解释一下 RSS 是什么", channelId: "chat-1" });
    expect(d.intent).toBe("chat");
    expect(d.matchedSignals).toContain("explain");
  });

  it("classifies plain Chinese summaries as chat", () => {
    const d = classifyMessageIntent({ content: "总结一下这篇文章", channelId: "chat-1" });
    expect(d.intent).toBe("chat");
    expect(d.matchedSignals).toContain("summary");
  });

  it("classifies ordinary URL summaries as chat but asks the LLM classifier to verify", () => {
    const d = classifyMessageIntent({ content: "https://example.com/post 给我总结一下", channelId: "chat-1" });
    expect(d.intent).toBe("chat");
    expect(d.matchedSignals).toContain("summary");
    expect(d.matchedSignals).toContain("external_url");
    expect(shouldUseLlmClassifier(d, policy)).toBe(true);
  });

  it("suggests task mode for WeChat public-account article summaries", () => {
    const d = classifyMessageIntent({
      content: "链接：https://mp.weixin.qq.com/s/43wPVMKzNxC_R0ZYmUn0Rg 给我总结一下",
      channelId: "chat-1",
    });
    expect(d.intent).toBe("task_suggest");
    expect(d.matchedSignals).toContain("wechat_article");
    expect(d.matchedSignals).toContain("browser_required");
    expect(d.riskFlags).toContain("browser_required");

    const resolved = resolveSmartRouterAction(d, policy, "chat-1");
    expect(resolved.intent).toBe("task_suggest");
  });

  it("does not ask the LLM classifier to downgrade WeChat article summaries", () => {
    const d = classifyMessageIntent({
      content: "链接：https://mp.weixin.qq.com/s/43wPVMKzNxC_R0ZYmUn0Rg 给我总结一下",
      channelId: "chat-1",
    });
    expect(shouldUseLlmClassifier(d, policy)).toBe(false);
  });

  it("suggests task mode for URL-only messages so the LLM classifier can decide", () => {
    const d = classifyMessageIntent({ content: "https://example.com/post", channelId: "chat-1" });
    expect(d.intent).toBe("task_suggest");
    expect(d.matchedSignals).toContain("external_url");
    expect(shouldUseLlmClassifier(d, policy)).toBe(true);
  });

  it("classifies file modification plus validation as task_confirm", () => {
    const d = classifyMessageIntent({ content: "修改 README 并跑测试", channelId: "chat-1" });
    expect(d.intent).toBe("task_confirm");
    expect(d.riskFlags).toContain("writes_files");
    expect(d.riskFlags).toContain("runs_tests");
  });

  it("classifies git operations as task_confirm", () => {
    const d = classifyMessageIntent({ content: "commit 并 push 到 GitHub main", channelId: "chat-1" });
    expect(d.intent).toBe("task_confirm");
    expect(d.riskFlags).toContain("git_operation");
  });

  it("classifies explicit capture or persistent output requests as task_confirm", () => {
    const d = classifyMessageIntent({
      content: "抓取这个公众号链接，整理成 Obsidian 笔记",
      channelId: "chat-1",
    });
    expect(d.intent).toBe("task_confirm");
    expect(d.matchedSignals).toContain("capture_or_persist");
    expect(d.riskFlags).toContain("long_running_or_persistent_output");
  });

  it("keeps attachment-only messages in chat by default", () => {
    const d = classifyMessageIntent({ content: "", channelId: "chat-1", hasAttachments: true });
    expect(d.intent).toBe("chat");
    expect(d.matchedSignals).toContain("attachments");
  });

  it("classifies repo analysis as task_suggest", () => {
    const d = classifyMessageIntent({ content: "帮我深入分析这个 repo", channelId: "chat-1" });
    expect(d.intent).toBe("task_suggest");
  });

  it("classifies runtime failure diagnosis as task_confirm", () => {
    const d = classifyMessageIntent({ content: "为什么会任务失败呢? 给我分析一下", channelId: "other" });
    expect(d.intent).toBe("task_confirm");
    expect(d.matchedSignals).toContain("runtime_diagnostics");
    expect(d.riskFlags).toContain("runtime_diagnostics");
  });
});

describe("LLM classifier decision points", () => {
  it("uses LLM for ambiguous suggestions", () => {
    const d = classifyMessageIntent({ content: "调研一下有没有方案", channelId: "chat-1" });
    expect(shouldUseLlmClassifier(d, policy)).toBe(true);
  });

  it("merges LLM decision with heuristic signals", async () => {
    const d = await classifySmartRoute(
      { content: "调研一下有没有方案", channelId: "chat-1" },
      policy,
      async () => ({
        intent: "chat",
        confidence: 0.8,
        reason: "research answer can be chat",
        matchedSignals: ["llm_classifier"],
        riskFlags: [],
      })
    );
    expect(d.intent).toBe("chat");
    expect(d.matchedSignals).toContain("research");
    expect(d.matchedSignals).toContain("llm_classifier");
  });

  it("keeps deterministic browser-required URL summaries as task_suggest without LLM override", async () => {
    const d = await classifySmartRoute(
      { content: "链接：https://mp.weixin.qq.com/s/43wPVMKzNxC_R0ZYmUn0Rg 给我总结一下", channelId: "chat-1" },
      policy,
      async () => ({
        intent: "chat",
        confidence: 0.9,
        reason: "should not be used",
        matchedSignals: ["llm_classifier"],
        riskFlags: [],
      })
    );
    expect(d.intent).toBe("task_suggest");
    expect(d.matchedSignals).not.toContain("llm_classifier");
  });

  it("still asks the LLM classifier to review ordinary URL summaries", async () => {
    const d = await classifySmartRoute(
      { content: "https://example.com/post 给我总结一下", channelId: "chat-1" },
      policy,
      async () => ({
        intent: "chat",
        confidence: 0.8,
        reason: "ordinary static page summary",
        matchedSignals: ["llm_classifier"],
        riskFlags: [],
      })
    );
    expect(d.intent).toBe("chat");
    expect(d.matchedSignals).toContain("external_url");
    expect(d.matchedSignals).toContain("llm_classifier");
  });

  it("fails closed to heuristic when LLM throws", async () => {
    const d = await classifySmartRoute(
      { content: "调研一下有没有方案", channelId: "chat-1" },
      policy,
      async () => {
        throw new Error("classifier unavailable");
      }
    );
    expect(d.intent).toBe("task_suggest");
    expect(d.riskFlags).toContain("classifier_failed");
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
