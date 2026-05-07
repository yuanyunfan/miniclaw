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

  it("keeps attachment-only messages in chat by default", () => {
    const d = classifyMessageIntent({ content: "", channelId: "chat-1", hasAttachments: true });
    expect(d.intent).toBe("chat");
    expect(d.matchedSignals).toContain("attachments");
  });

  it("classifies repo analysis as task_suggest", () => {
    const d = classifyMessageIntent({ content: "帮我深入分析这个 repo", channelId: "chat-1" });
    expect(d.intent).toBe("task_suggest");
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

  it("preserves confirmation in configured channel", () => {
    const decision = classifyMessageIntent({ content: "修改 README 并跑测试", channelId: "chat-1" });
    const resolved = resolveSmartRouterAction(decision, policy, "chat-1");
    expect(resolved.intent).toBe("task_confirm");
  });
});
