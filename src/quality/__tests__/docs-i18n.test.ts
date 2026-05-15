import { describe, expect, it } from "vitest";
import {
  analyzeDocsI18n,
  parseDocumentationMigrationMap,
  type DocumentationMigrationEntry,
} from "../docs-i18n.js";

const currentEntry: DocumentationMigrationEntry = {
  doc_id: "architecture",
  source_path: "docs/architecture.md",
  zh_path: "docs/zh/architecture.zh.md",
  category: "architecture",
  status: "keep",
  website_exposure: "public",
  translation_required: true,
  translation_status: "current",
};

function analyze(
  files: Record<string, string>,
  entries = [currentEntry],
  ignoredPaths = new Set<string>(),
  diffDisabledPaths = new Set<string>(),
  trackedSourcePaths: string[] = [],
) {
  return analyzeDocsI18n({
    entries,
    ignoredPaths,
    diffDisabledPaths,
    trackedSourcePaths,
    exists: (path) => files[path] !== undefined,
    readText: (path) => files[path] ?? "",
  });
}

describe("documentation i18n checks", () => {
  it("parses the migration map JSON block", () => {
    const entries = parseDocumentationMigrationMap(`
# Map

\`\`\`json
[
  {
    "doc_id": "architecture",
    "source_path": "docs/architecture.md",
    "zh_path": "docs/zh/architecture.zh.md",
    "category": "architecture",
    "status": "keep",
    "website_exposure": "public",
    "translation_required": true,
    "translation_status": "current"
  }
]
\`\`\`
`);

    expect(entries).toEqual([currentEntry]);
  });

  it("passes when the Chinese pair points back to the English source", () => {
    const findings = analyze({
      "docs/architecture.md": "# Architecture\n\n## Runtime\n",
      "docs/zh/architecture.zh.md": `---
doc_id: architecture
lang: zh
translation_of: docs/architecture.md
translation_status: current
---
# 架构

## Runtime
`,
    });

    expect(findings).toEqual([]);
  });

  it("reports invalid Chinese metadata and ignored docs/zh paths", () => {
    const findings = analyze(
      {
        "docs/architecture.md": "# Architecture\n",
        "docs/zh/architecture.zh.md": `---
doc_id: wrong
lang: en
translation_of: docs/other.md
translation_status: current
---
# 架构
`,
      },
      [currentEntry],
      new Set(["docs/zh/architecture.zh.md"]),
      new Set(["docs/zh/architecture.zh.md"]),
    );

    expect(findings.map((finding) => finding.reason)).toEqual(
      expect.arrayContaining([
        "Chinese documentation path is ignored by git",
        "Chinese documentation path disables text diff through gitattributes",
        "frontmatter lang must be zh",
        "translation_of must be docs/architecture.md",
        "doc_id must be architecture",
      ]),
    );
  });

  it("blocks pending translations for required docs", () => {
    const pendingEntry: DocumentationMigrationEntry = {
      ...currentEntry,
      translation_status: "pending",
    };
    const findings = analyze(
      {
        "docs/architecture.md": "# Architecture\n\n## Runtime\n",
        "docs/zh/architecture.zh.md": `---
doc_id: architecture
lang: zh
translation_of: docs/architecture.md
translation_status: pending
---
# 架构
`,
      },
      [pendingEntry],
    );

    expect(findings).toEqual([
      {
        severity: "error",
        path: "docs/architecture.md",
        reason: "translation_status pending is not allowed for translation_required docs",
      },
    ]);
  });

  it("reports tracked source docs missing from the migration map", () => {
    const findings = analyze(
      {
        "docs/architecture.md": "# Architecture\n",
        "docs/bot-routing.md": "# Bot Routing\n",
        "docs/zh/architecture.zh.md": `---
doc_id: architecture
lang: zh
translation_of: docs/architecture.md
translation_status: current
---
# 架构
`,
      },
      [currentEntry],
      new Set(),
      new Set(),
      ["docs/architecture.md", "docs/bot-routing.md"],
    );

    expect(findings).toEqual([
      {
        severity: "error",
        path: "docs/bot-routing.md",
        reason: "tracked source doc is missing from documentation migration map",
      },
    ]);
  });
});
