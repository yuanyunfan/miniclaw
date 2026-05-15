import { describe, expect, it } from "vitest";
import { analyzeWebsiteDocs } from "../website-docs.js";

describe("website docs checks", () => {
  it("requires source_docs on non-landing pages", () => {
    const result = analyzeWebsiteDocs({
      pages: [
        {
          path: "website/en/design/architecture.md",
          text: `---
status: public-summary
---
# Architecture
`,
        },
      ],
      sourceExists: () => true,
    });

    expect(result.findings).toEqual([
      {
        path: "website/en/design/architecture.md",
        reason: "website page must declare source_docs unless status is landing",
      },
    ]);
  });

  it("fails when a canonical source changes without updating the affected website page", () => {
    const result = analyzeWebsiteDocs({
      pages: [
        {
          path: "website/en/design/architecture.md",
          text: `---
status: public-summary
source_docs:
  en:
    - docs/architecture.md
  zh:
    - docs/zh/architecture.zh.md
---
# Architecture
`,
        },
      ],
      changedPaths: ["docs/architecture.md"],
      sourceExists: (path) => path === "docs/architecture.md" || path === "docs/zh/architecture.zh.md",
    });

    expect(result.findings).toEqual([
      {
        path: "website/en/design/architecture.md",
        reason: "canonical source changed without website update: docs/architecture.md",
      },
    ]);
    expect(result.affectedPages).toEqual([
      { page: "website/en/design/architecture.md", source: "docs/architecture.md" },
    ]);
  });

  it("passes affected pages when the website page is changed in the same patch", () => {
    const result = analyzeWebsiteDocs({
      pages: [
        {
          path: "website/en/design/architecture.md",
          text: `---
status: public-summary
source_docs:
  en:
    - docs/architecture.md
  zh:
    - docs/zh/architecture.zh.md
---
# Architecture
`,
        },
      ],
      changedPaths: ["docs/architecture.md", "website/en/design/architecture.md"],
      sourceExists: (path) => path === "docs/architecture.md" || path === "docs/zh/architecture.zh.md",
    });

    expect(result.findings).toEqual([]);
    expect(result.affectedPages).toEqual([
      { page: "website/en/design/architecture.md", source: "docs/architecture.md" },
    ]);
  });

  it("passes affected pages with an explicit unaffected override", () => {
    const result = analyzeWebsiteDocs({
      pages: [
        {
          path: "website/en/design/architecture.md",
          text: `---
status: public-summary
website_docs_drift: unaffected
website_docs_drift_reason: "source edit only corrected internal owner paths"
source_docs:
  en:
    - docs/architecture.md
---
# Architecture
`,
        },
      ],
      changedPaths: ["docs/architecture.md"],
      sourceExists: (path) => path === "docs/architecture.md",
    });

    expect(result.findings).toEqual([]);
    expect(result.affectedPages).toEqual([
      { page: "website/en/design/architecture.md", source: "docs/architecture.md" },
    ]);
  });

  it("blocks private docs and archive docs outside history pages", () => {
    const result = analyzeWebsiteDocs({
      pages: [
        {
          path: "website/en/reference/provider.md",
          text: `---
status: public-summary
source_docs:
  en:
    - docs/private/eastmoney/session.md
    - docs/archive/old.md
---
# Provider
`,
        },
      ],
      sourceExists: () => true,
    });

    expect(result.findings.map((finding) => finding.reason)).toEqual([
      "source_docs must not point to private docs: docs/private/eastmoney/session.md",
      "archive source_docs require status: history: docs/archive/old.md",
    ]);
  });
});
