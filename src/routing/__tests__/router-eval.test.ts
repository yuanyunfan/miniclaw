import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  classifySmartRoute,
  type RouteCapabilityDecision,
  type RouteIntent,
  type SmartRouterPolicy,
} from "../intent.js";

type CapabilityName = keyof Pick<
  RouteCapabilityDecision,
  | "needsCurrentInfo"
  | "needsMultiStepResearch"
  | "needsFileWrite"
  | "needsShell"
  | "needsGit"
  | "needsBrowser"
  | "needsRuntimeInspection"
  | "needsLongRunning"
  | "createsPersistentOutput"
>;

interface RouterEvalCase {
  name: string;
  prompt: string;
  expectedRoute: RouteIntent;
  expectedCapabilities: CapabilityName[];
  classifierCapabilities?: Partial<RouteCapabilityDecision>;
}

const evals = JSON.parse(
  readFileSync(new URL("../__fixtures__/router-evals.json", import.meta.url), "utf8")
) as RouterEvalCase[];

const policy: SmartRouterPolicy = {
  enabled: true,
  defaultMode: "confirm",
  minConfirmConfidence: 0.55,
  minAutoConfidence: 0.9,
  confirmChannelIds: ["chat-1"],
  autoTaskChannelIds: [],
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
    reason: "fixture classifier decision",
    evidence: ["fixture"],
    matchedSignals: ["fixture"],
    riskFlags: [],
    ...overrides,
  };
}

describe("router eval fixtures", () => {
  for (const row of evals) {
    it(row.name, async () => {
      const decision = await classifySmartRoute(
        { content: row.prompt, channelId: "chat-1" },
        policy,
        async () => capability(row.classifierCapabilities)
      );
      expect(decision.intent).toBe(row.expectedRoute);
      for (const capability of row.expectedCapabilities) {
        expect(decision.capabilities?.[capability], capability).toBe(true);
      }
    });
  }
});
