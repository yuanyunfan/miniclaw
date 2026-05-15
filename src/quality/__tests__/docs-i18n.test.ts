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

function analyze(files: Record<string, string>, entries = [currentEntry], ignoredPaths = new Set<string>()) {
  return analyzeDocsI18n({
    entries,
    ignoredPaths,
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
    );

    expect(findings.map((finding) => finding.reason)).toEqual(
      expect.arrayContaining([
        "Chinese documentation path is ignored by git",
        "frontmatter lang must be zh",
        "translation_of must be docs/architecture.md",
        "doc_id must be architecture",
      ]),
    );
  });
});
