import { describe, expect, it } from "vitest";
import {
  evaluateDocsDrift,
  findDocsDriftFindings,
  hasRequiredDocChange,
  matchDocRequirements,
  matchesPathPattern,
} from "../docs-drift.js";

describe("docs drift path matching", () => {
  it("matches exact paths and single-level feature docs globs", () => {
    expect(matchesPathPattern("src/bot.ts", "src/bot.ts")).toBe(true);
    expect(matchesPathPattern("docs/features/04-smart-task-router.md", "docs/features/*.md")).toBe(true);
    expect(matchesPathPattern("docs/features/archive/old.md", "docs/features/*.md")).toBe(false);
    expect(matchesPathPattern("docs/providers/provider-framework.md", "docs/providers/*.md")).toBe(true);
    expect(matchesPathPattern("docs/providers/stock/eastmoney.md", "docs/providers/**/*.md")).toBe(true);
  });

  it("matches recursive source globs", () => {
    expect(matchesPathPattern("src/discord/task-context.ts", "src/discord/**")).toBe(true);
    expect(matchesPathPattern("src/discord/nested/task-context.ts", "src/discord/**")).toBe(true);
    expect(matchesPathPattern("src/routing/intent.ts", "src/discord/**")).toBe(false);
  });
});

describe("docs drift requirement matching", () => {
  it("requires routing docs for Discord routing source changes", () => {
    const matches = matchDocRequirements(["src/bot.ts"]);

    expect(matches).toHaveLength(1);
    expect(matches[0].requirement.id).toBe("discord-routing");
    expect(matches[0].sourcePaths).toEqual(["src/bot.ts"]);
  });

  it("passes when a mapped routing doc changes in the same path set", () => {
    const findings = findDocsDriftFindings(["src/routing/intent.ts", "docs/bot-routing.md"]);

    expect(findings).toEqual([]);
  });

  it("does not let plan docs satisfy source-of-truth docs requirements", () => {
    const findings = findDocsDriftFindings([
      "src/routing/intent.ts",
      "docs/plans/2026-05-11-docs-drift-gate.md",
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].requirement.id).toBe("discord-routing");
    expect(findings[0].missingAnyOf).toContain("docs/bot-routing.md");
  });

  it("ignores tests, fixtures, plans, and archive-only changes as source triggers", () => {
    const evaluation = evaluateDocsDrift([
      "src/cron/__tests__/loader.test.ts",
      "src/routing/__fixtures__/router-review.json",
      "docs/plans/2026-05-11-docs-drift-gate.md",
      "docs/archive/2026-05-11-continuous-improvement-report.md",
      "docs/archive/old-report.md",
    ]);

    expect(evaluation.matchedRequirements).toEqual([]);
    expect(evaluation.findings).toEqual([]);
  });

  it("requires quality gate docs when quality scripts change", () => {
    const findings = findDocsDriftFindings(["scripts/quality-docs.ts", "src/quality/docs-drift.ts"]);

    expect(findings).toHaveLength(1);
    expect(findings[0].requirement.id).toBe("quality-gates");
    expect(findings[0].sourcePaths).toEqual(["scripts/quality-docs.ts", "src/quality/docs-drift.ts"]);
    expect(hasRequiredDocChange(findings[0].requirement, ["scripts/quality-docs.ts", "docs/quality-gates.md"])).toBe(true);
  });

  it("maps split config modules to config docs requirements", () => {
    const findings = findDocsDriftFindings(["src/config/env.ts"]);

    expect(findings).toHaveLength(1);
    expect(findings[0].requirement.id).toBe("config");
    expect(findings[0].sourcePaths).toEqual(["src/config/env.ts"]);
    expect(hasRequiredDocChange(findings[0].requirement, ["src/config/env.ts", "docs/architecture.md"])).toBe(true);
  });

  it("requires prompt docs and prompt snapshot tests for prompt asset changes", () => {
    const missingSnapshot = findDocsDriftFindings(["prompts/supervisor.md", "docs/prompts.md"]);

    expect(missingSnapshot).toHaveLength(1);
    expect(missingSnapshot[0].requirement.id).toBe("prompts");
    expect(missingSnapshot[0].missingAnyOf).toEqual([]);
    expect(missingSnapshot[0].missingAllOf).toEqual(["src/__tests__/prompt-snapshot.test.ts"]);

    expect(
      findDocsDriftFindings([
        "prompts/supervisor.md",
        "docs/prompts.md",
        "src/__tests__/prompt-snapshot.test.ts",
      ])
    ).toEqual([]);
  });

  it("maps provider source changes to provider docs and rejects legacy feature stubs", () => {
    expect(
      findDocsDriftFindings([
        "src/providers/wechat-mp/collector.ts",
        "docs/providers/content.md",
      ])
    ).toEqual([]);
    expect(
      findDocsDriftFindings(["src/ops/doctor-repair.ts", "docs/features/13-auto-doctor.md"])
    ).toHaveLength(1);
  });

  it("accepts new taxonomy docs for runtime, provider, and experiment source changes", () => {
    expect(
      findDocsDriftFindings(["src/providers/stock-pulse/index.ts", "docs/providers/stock/research.md"])
    ).toEqual([]);
    expect(
      findDocsDriftFindings(["src/agent/task.ts", "docs/runtime/README.md"])
    ).toEqual([]);
    expect(
      findDocsDriftFindings(["src/stage/runtime.ts", "docs/experiments/README.md"])
    ).toEqual([]);
  });
});
