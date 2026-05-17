import { describe, expect, it } from "vitest";
import { analyzeWebsiteDocs, parseWebsiteDocsAck } from "../website-docs.js";

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
        reason: "website page must declare source_docs or trace_docs unless status is landing",
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
    expect(result.tracePages).toEqual([]);
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
    expect(result.tracePages).toEqual([]);
  });

  it("uses the website page language when checking affected source_docs", () => {
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
      changedPaths: ["docs/zh/architecture.zh.md"],
      sourceExists: (path) => path === "docs/architecture.md" || path === "docs/zh/architecture.zh.md",
    });

    expect(result.findings).toEqual([]);
    expect(result.affectedPages).toEqual([]);
    expect(result.tracePages).toEqual([]);
  });

  it("does not let legacy page-frontmatter unaffected override bypass blocking source docs", () => {
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

    expect(result.findings).toEqual([
      {
        path: "website/en/design/architecture.md",
        reason: "canonical source changed without website update: docs/architecture.md",
      },
    ]);
    expect(result.affectedPages).toEqual([
      { page: "website/en/design/architecture.md", source: "docs/architecture.md" },
    ]);
    expect(result.tracePages).toEqual([]);
  });

  it("reports trace-only docs without failing", () => {
    const result = analyzeWebsiteDocs({
      pages: [
        {
          path: "website/en/capabilities/runtime.md",
          text: `---
status: public-summary
trace_docs:
  en:
    - docs/runtime/README.md
---
# Runtime
`,
        },
      ],
      changedPaths: ["docs/runtime/README.md"],
      sourceExists: (path) => path === "docs/runtime/README.md",
    });

    expect(result.findings).toEqual([]);
    expect(result.affectedPages).toEqual([]);
    expect(result.tracePages).toEqual([
      { page: "website/en/capabilities/runtime.md", source: "docs/runtime/README.md" },
    ]);
  });

  it("passes blocking docs with a same-patch central unaffected ack", () => {
    const result = analyzeWebsiteDocs({
      pages: [
        {
          path: "website/en/design/architecture.md",
          text: `---
status: public-summary
source_docs:
  en:
    - docs/architecture.md
---
# Architecture
`,
        },
      ],
      changedPaths: ["docs/architecture.md", ".website-docs-drift-ack.md"],
      ackPathChanged: true,
      ackText: "- page=website/en/design/architecture.md source=docs/architecture.md reason=internal implementation detail only\n",
      sourceExists: (path) => path === "docs/architecture.md",
    });

    expect(result.findings).toEqual([]);
    expect(result.affectedPages).toEqual([
      { page: "website/en/design/architecture.md", source: "docs/architecture.md" },
    ]);
    expect(result.tracePages).toEqual([]);
  });

  it("does not apply central unaffected ack unless the ack file changed", () => {
    const result = analyzeWebsiteDocs({
      pages: [
        {
          path: "website/en/design/architecture.md",
          text: `---
status: public-summary
source_docs:
  en:
    - docs/architecture.md
---
# Architecture
`,
        },
      ],
      changedPaths: ["docs/architecture.md"],
      ackPathChanged: false,
      ackText: "- page=website/en/design/architecture.md source=docs/architecture.md reason=internal implementation detail only\n",
      sourceExists: (path) => path === "docs/architecture.md",
    });

    expect(result.findings).toEqual([
      {
        path: "website/en/design/architecture.md",
        reason: "canonical source changed without website update: docs/architecture.md",
      },
    ]);
  });

  it("parses central unaffected ack entries", () => {
    const parsed = parseWebsiteDocsAck(`
# same-patch notes
- page=website/en/index.md source=docs/runtime/README.md reason=internal runtime detail only
`);

    expect(parsed.findings).toEqual([]);
    expect(parsed.acks).toEqual([
      {
        page: "website/en/index.md",
        source: "docs/runtime/README.md",
        reason: "internal runtime detail only",
      },
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
      "website source references must not point to private docs: docs/private/eastmoney/session.md",
      "archive website source references require status: history: docs/archive/old.md",
    ]);
  });
});
