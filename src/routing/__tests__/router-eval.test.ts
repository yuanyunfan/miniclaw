import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { classifyMessageIntent, type RouteCapabilityDecision, type RouteIntent } from "../intent.js";

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
}

const evals = JSON.parse(
  readFileSync(new URL("../__fixtures__/router-evals.json", import.meta.url), "utf8")
) as RouterEvalCase[];

describe("router eval fixtures", () => {
  for (const row of evals) {
    it(row.name, () => {
      const decision = classifyMessageIntent({ content: row.prompt, channelId: "chat-1" });
      expect(decision.intent).toBe(row.expectedRoute);
      for (const capability of row.expectedCapabilities) {
        expect(decision.capabilities?.[capability], capability).toBe(true);
      }
    });
  }
});
