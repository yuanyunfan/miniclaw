import { describe, expect, it } from "vitest";
import { analyzeChangelogDrift } from "../changelog.js";

describe("changelog drift checks", () => {
  it("passes when no release-visible path changed", () => {
    expect(analyzeChangelogDrift(["src/bot/__tests__/message-chat.test.ts"])).toEqual([]);
  });

  it("requires CHANGELOG.md for source changes", () => {
    expect(analyzeChangelogDrift(["src/bot.ts"])).toEqual([
      {
        path: "CHANGELOG.md",
        reason: "CHANGELOG.md must be updated with release-visible changes: src/bot.ts",
      },
    ]);
  });

  it("requires CHANGELOG.md for docs, website, and workflow changes", () => {
    const findings = analyzeChangelogDrift([
      "docs/quality-gates.md",
      "website/en/index.md",
      ".github/workflows/quality.yml",
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toContain("docs/quality-gates.md");
    expect(findings[0].reason).toContain("website/en/index.md");
    expect(findings[0].reason).toContain(".github/workflows/quality.yml");
  });

  it("passes when CHANGELOG.md changes in the same patch", () => {
    expect(analyzeChangelogDrift(["src/bot.ts", "CHANGELOG.md"])).toEqual([]);
  });

  it("ignores archive and private docs", () => {
    expect(
      analyzeChangelogDrift([
        "docs/archive/2026-05-11-continuous-improvement-report.md",
        "docs/private/eastmoney/stock-research.md",
      ]),
    ).toEqual([]);
  });
});
