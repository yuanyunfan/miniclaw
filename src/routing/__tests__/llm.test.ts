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
      estimated_effort: "medium",
      confidence: 0.83,
      reason: "requires current GitHub activity analysis",
      evidence: ["github_activity", "current_info"],
      risk_flags: ["long_running_research"],
    }));

    expect(parsed.needsCurrentInfo).toBe(true);
    expect(parsed.needsMultiStepResearch).toBe(true);
    expect(parsed.needsLongRunning).toBe(true);
    expect(parsed.hasExternalUrl).toBe(true);
    expect(parsed.estimatedEffort).toBe("medium");
    expect(parsed.confidence).toBe(0.83);
    expect(parsed.matchedSignals).toContain("llm_classifier");
    expect(parsed.lockedCapabilities).toEqual([]);
  });

  it("builds a capability prompt without asking the classifier to route directly", () => {
    const prompt = __testables.classifierPrompt("帮我分析最近 GitHub activity", {
      needsCurrentInfo: true,
      needsMultiStepResearch: true,
      needsFileWrite: false,
      needsShell: false,
      needsGit: false,
      needsBrowser: false,
      needsRuntimeInspection: false,
      needsLongRunning: true,
      createsPersistentOutput: false,
      hasExternalUrl: false,
      hasAttachments: false,
      estimatedEffort: "medium",
      confidence: 0.58,
      reason: "message likely needs current multi-step research",
      evidence: ["external_activity_research"],
      matchedSignals: ["external_activity_research"],
      riskFlags: ["long_running_research"],
      lockedCapabilities: [],
    });

    expect(prompt).toContain("Classify the capabilities needed");
    expect(prompt).toContain("Routing policy is NOT your job");
    expect(prompt).toContain("needs_current_info");
    expect(prompt).not.toContain('"intent"');
  });
});
