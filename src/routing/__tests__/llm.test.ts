import { describe, expect, it } from "vitest";
import { __testables } from "../llm.js";

describe("capability LLM classifier helpers", () => {
  it("parses snake_case capability JSON", () => {
    const parsed = __testables.parseCapabilityJson(JSON.stringify({
      needs_current_info: true,
      needs_multi_step_research: true,
      needs_file_write: false,
      needs_shell: false,
      needs_git: false,
      needs_browser: false,
      needs_runtime_inspection: false,
      needs_long_running: true,
      creates_persistent_output: false,
      has_external_url: true,
      has_attachments: false,
      is_url_only: false,
      estimated_effort: "medium",
      confidence: 0.83,
      reason: "requires current GitHub activity analysis",
      evidence: ["github_activity", "current_info"],
      risk_flags: ["long_running_research"],
      user_intent: "explain current contribution spike",
      ambiguity: "low",
    }));

    expect(parsed.needsCurrentInfo).toBe(true);
    expect(parsed.needsMultiStepResearch).toBe(true);
    expect(parsed.needsLongRunning).toBe(true);
    expect(parsed.hasExternalUrl).toBe(true);
    expect(parsed.isUrlOnly).toBe(false);
    expect(parsed.estimatedEffort).toBe("medium");
    expect(parsed.confidence).toBe(0.83);
    expect(parsed.matchedSignals).toContain("llm_classifier");
    expect(parsed.userIntent).toBe("explain current contribution spike");
    expect(parsed.ambiguity).toBe("low");
  });

  it("builds an LLM-first capability prompt without heuristic hints or direct routing", () => {
    const prompt = __testables.classifierPrompt({
      content: "帮我分析最近 GitHub activity",
      channelId: "chat-1",
      hasAttachments: false,
    });

    expect(prompt).toContain("Classify the capabilities needed");
    expect(prompt).toContain("Routing policy is NOT your job");
    expect(prompt).toContain("Do not use keyword matching");
    expect(prompt).toContain("steipete的1099 次贡献");
    expect(prompt).toContain("stock-pulse");
    expect(prompt).toContain("needs_current_info");
    expect(prompt).not.toContain("Heuristic capability hints");
    expect(prompt).not.toContain('"intent"');
  });
});
