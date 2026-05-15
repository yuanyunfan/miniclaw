---
status: public-summary
source_docs:
  en:
    - docs/quality-gates.md
    - docs/documentation-migration-map.md
  zh:
    - docs/zh/quality-gates.zh.md
---

# Quality Gates

MiniClaw uses executable gates to keep code, docs, website pages, and bilingual docs aligned.

- `quality:docs:drift`: code-to-docs source-of-truth drift.
- `quality:docs-i18n`: English/Chinese doc pairing, metadata, and current translation parity.
- `quality:website-docs`: website page `source_docs` traceability, blocking affected pages unless they are updated or explicitly marked unaffected.
- Pages workflow: build and validation always run; deployment is skipped with an artifact upload when GitHub Pages has not been enabled for the repository yet.
